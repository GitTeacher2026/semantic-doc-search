import {
  buildEditedPdf,
  DEFAULT_RENDER_SCALE,
  extractPagesPdf,
  getActivePageIndices,
  loadPdfDocument,
  pageHasNativeText,
  pdfHasNativeText,
  renderPageToBlob,
  renderPageToCanvas,
  renderTextLayer,
} from "./pdf-utils.js";
import {
  addAnnotation,
  bindAnnotationInteractions,
  createAnnotationStore,
  deleteSelectedAnnotation,
  EDIT_TOOLS,
  exportAnnotationsByPage,
  findAnnotation,
  getPageAnnotations,
  renderAnnotationsOverlay,
  setActiveTool,
} from "./pdf-annotations.js";
import { ensurePuterConnected, extractImageText, formatOcrProgress } from "./ocr.js";

let modalEl = null;
let callbacks = {};
let studioState = null;
let annotationStore = null;
let renderTaskId = 0;
let textDialogResolver = null;
let signatureDialogResolver = null;
let signatureDrawing = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(message, isError = false) {
  const statusEl = modalEl?.querySelector("#pdf-studio-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.classList.toggle("is-error", Boolean(isError && message));
  statusEl.classList.toggle("hidden", !message);
}

function getVisibleIndices() {
  if (!studioState) return [];
  return getActivePageIndices(studioState.totalPages, studioState.deletedPages);
}

function getCurrentOriginalIndex() {
  const visible = getVisibleIndices();
  return visible[studioState.currentVisibleIndex] ?? visible[0] ?? 0;
}

function normalizeRotation(value) {
  const rot = ((value % 360) + 360) % 360;
  return rot === 0 ? 0 : rot;
}

function getEffectiveScale() {
  return DEFAULT_RENDER_SCALE * (studioState?.zoom || 1);
}

function updateZoomLabel() {
  const label = modalEl?.querySelector("#pdf-studio-zoom-label");
  if (label && studioState) {
    label.textContent = `${Math.round((studioState.zoom || 1) * 100)}%`;
  }
}

function syncOverlaySize(cssWidth, cssHeight) {
  const overlay = modalEl.querySelector("#pdf-studio-overlay");
  const wrap = modalEl.querySelector("#pdf-studio-page-wrap");
  if (!overlay || !wrap) return;
  overlay.width = Math.max(1, Math.floor(cssWidth));
  overlay.height = Math.max(1, Math.floor(cssHeight));
  overlay.style.width = `${cssWidth}px`;
  overlay.style.height = `${cssHeight}px`;
  wrap.style.width = `${cssWidth}px`;
}

function renderOverlay() {
  const overlay = modalEl.querySelector("#pdf-studio-overlay");
  if (!overlay || !studioState) return;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  renderAnnotationsOverlay(ctx, annotationStore, getCurrentOriginalIndex());
}

function renderAnnotationLayer() {
  const layer = modalEl.querySelector("#pdf-studio-annotation-layer");
  if (!layer || !studioState) return;
  const pageIndex = getCurrentOriginalIndex();
  const isSelect = annotationStore.activeTool === EDIT_TOOLS.SELECT;
  const list = getPageAnnotations(annotationStore, pageIndex);

  if (!isSelect || !list.length) {
    layer.classList.add("hidden");
    layer.innerHTML = "";
    return;
  }

  layer.classList.remove("hidden");
  layer.innerHTML = list
    .map(
      (ann) => `
    <button
      type="button"
      class="pdf-ann-hit${ann.id === annotationStore.selectedId ? " is-selected" : ""}"
      style="left:${ann.x}px;top:${ann.y}px;width:${ann.width}px;height:${ann.height}px;"
      data-id="${ann.id}"
      title="${ann.type === "text" ? "انقر مرتين للتعديل" : "تحديد التعليق"}"
    ></button>`
    )
    .join("");

  layer.querySelectorAll(".pdf-ann-hit").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      annotationStore.selectedId = btn.dataset.id;
      renderAnnotationLayer();
      renderOverlay();
    });
    btn.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      const ann = findAnnotation(annotationStore, pageIndex, btn.dataset.id);
      if (ann?.type === "text") editTextAnnotation(ann, pageIndex);
    });
  });
}

async function renderCurrentPage() {
  if (!studioState?.pdfDoc) return;
  const taskId = ++renderTaskId;
  const canvas = modalEl.querySelector("#pdf-studio-canvas");
  const textLayer = modalEl.querySelector("#pdf-studio-text-layer");
  const visible = getVisibleIndices();
  if (!visible.length) {
    canvas.width = 0;
    canvas.height = 0;
    return;
  }

  const originalIndex = getCurrentOriginalIndex();
  const rotation = studioState.rotations[originalIndex] || 0;
  studioState.currentVisibleIndex = Math.min(studioState.currentVisibleIndex, visible.length - 1);

  const meta = await renderPageToCanvas(studioState.pdfDoc, originalIndex + 1, canvas, {
    scale: getEffectiveScale(),
    rotation,
  });
  if (taskId !== renderTaskId) return;

  const page = await studioState.pdfDoc.getPage(originalIndex + 1);
  const baseViewport = page.getViewport({ scale: 1, rotation });
  page.cleanup?.();

  studioState.pageViewports[originalIndex] = {
    width: meta.cssWidth,
    height: meta.cssHeight,
    pdfWidth: baseViewport.width,
    pdfHeight: baseViewport.height,
  };

  syncOverlaySize(meta.cssWidth, meta.cssHeight);

  const isSelect = annotationStore.activeTool === EDIT_TOOLS.SELECT;
  const pageHasText =
    isSelect &&
    studioState.hasNativeText &&
    (await pageHasNativeText(studioState.pdfDoc, originalIndex + 1));
  if (pageHasText) {
    await renderTextLayer(studioState.pdfDoc, originalIndex + 1, textLayer, meta.viewport);
    textLayer?.classList.add("is-selectable");
  } else if (textLayer) {
    textLayer.innerHTML = "";
    textLayer.classList.remove("is-selectable");
  }
  if (taskId !== renderTaskId) return;

  renderOverlay();
  renderAnnotationLayer();

  const pageLabel = modalEl.querySelector("#pdf-studio-page-label");
  if (pageLabel) {
    pageLabel.textContent = `صفحة ${studioState.currentVisibleIndex + 1} من ${visible.length}`;
  }
  updateZoomLabel();
  renderThumbnails();
  updateToolbarState();
}

function renderThumbnails() {
  const container = modalEl.querySelector("#pdf-studio-thumbs");
  if (!container || !studioState) return;

  const visible = getVisibleIndices();
  container.innerHTML = visible
    .map((originalIndex, visibleIndex) => {
      const rot = studioState.rotations[originalIndex] || 0;
      const ocr = studioState.ocrTexts[originalIndex];
      const annCount = annotationStore.byPage[originalIndex]?.length || 0;
      const active = visibleIndex === studioState.currentVisibleIndex ? " is-active" : "";
      return `
        <button
          type="button"
          class="pdf-studio-thumb${active}"
          data-visible-index="${visibleIndex}"
          title="صفحة ${visibleIndex + 1}${ocr ? " — نص مستخرج" : ""}${annCount ? ` — ${annCount} تعديل` : ""}"
        >
          <span class="pdf-studio-thumb-num">${visibleIndex + 1}</span>
          ${rot ? `<span class="pdf-studio-thumb-rot">${rot}°</span>` : ""}
          ${ocr ? '<span class="pdf-studio-thumb-ocr" aria-hidden="true">📝</span>' : ""}
          ${annCount ? `<span class="pdf-studio-thumb-edit" aria-hidden="true">✏</span>` : ""}
        </button>`;
    })
    .join("");

  container.querySelectorAll(".pdf-studio-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      studioState.currentVisibleIndex = Number(btn.dataset.visibleIndex);
      renderCurrentPage();
    });
  });
}

function updateToolbarState() {
  const visible = getVisibleIndices();
  const hasPages = visible.length > 0;
  const showOcr = hasPages && !studioState?.hasNativeText;
  modalEl.querySelector("#pdf-studio-prev")?.toggleAttribute("disabled", !hasPages || studioState.currentVisibleIndex <= 0);
  modalEl.querySelector("#pdf-studio-next")?.toggleAttribute(
    "disabled",
    !hasPages || studioState.currentVisibleIndex >= visible.length - 1
  );
  modalEl.querySelector("#pdf-studio-delete-page")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-rotate")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-ocr-page")?.toggleAttribute("disabled", !showOcr);
  modalEl.querySelector("#pdf-studio-ocr-all")?.toggleAttribute("disabled", !showOcr);
  modalEl.querySelector("#pdf-studio-ocr-page")?.classList.toggle("hidden", !showOcr);
  modalEl.querySelector("#pdf-studio-ocr-all")?.classList.toggle("hidden", !showOcr);
  modalEl.querySelector("#pdf-studio-extract")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-save")?.toggleAttribute("disabled", !hasPages && !studioState.appendBuffers.length);
}

async function buildOutputBytes() {
  return buildEditedPdf(studioState.sourceBytes, {
    deletedPages: studioState.deletedPages,
    rotations: studioState.rotations,
    appendBuffers: studioState.appendBuffers,
    annotationsByPage: exportAnnotationsByPage(annotationStore),
    pageViewports: studioState.pageViewports,
  });
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function ocrPage(originalIndex) {
  await ensurePuterConnected();
  setStatus(`جارٍ OCR للصفحة ${originalIndex + 1}…`);
  const blob = await renderPageToBlob(studioState.pdfDoc, originalIndex + 1, {
    scale: 2.5,
    rotation: studioState.rotations[originalIndex] || 0,
  });
  const result = await extractImageText(blob, (progress) => {
    setStatus(`${formatOcrProgress(progress)} — صفحة ${originalIndex + 1}`);
  });
  const text = typeof result === "string" ? result : result.text;
  if (!text?.trim()) throw new Error(`لم يُعثر على نص في الصفحة ${originalIndex + 1}.`);
  studioState.ocrTexts[originalIndex] = text.trim();
  return text.trim();
}

function collectOcrText() {
  const visible = getVisibleIndices();
  return visible
    .map((index) => studioState.ocrTexts[index])
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function setEditTool(tool) {
  setActiveTool(annotationStore, tool);
  modalEl.querySelectorAll(".pdf-studio-tool").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === tool);
  });
  const overlay = modalEl.querySelector("#pdf-studio-overlay");
  const isSelect = tool === EDIT_TOOLS.SELECT;
  overlay?.classList.toggle("is-interactive", !isSelect);
  renderAnnotationLayer();
  renderOverlay();
  if (studioState?.pdfDoc) {
    renderCurrentPage();
  }
}

function placeInlineTextEditor(point, { initialText = "", onSave } = {}) {
  const wrap = modalEl.querySelector("#pdf-studio-page-wrap");
  wrap?.querySelector(".pdf-inline-text-editor")?.remove();

  const editor = document.createElement("div");
  editor.className = "pdf-inline-text-editor";
  editor.contentEditable = "true";
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", "نص جديد");
  editor.style.left = `${Math.max(0, point.x)}px`;
  editor.style.top = `${Math.max(0, point.y)}px`;
  editor.style.fontSize = `${annotationStore.textSize || 16}px`;
  if (initialText) editor.textContent = initialText;
  wrap?.appendChild(editor);
  editor.focus();

  const commit = () => {
    const text = editor.textContent?.trim() || "";
    editor.remove();
    if (text) onSave?.(text);
  };

  editor.addEventListener("blur", () => {
    window.setTimeout(commit, 0);
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      editor.remove();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  });
}

function editTextAnnotation(ann, pageIndex) {
  placeInlineTextEditor({ x: ann.x, y: ann.y }, {
    initialText: ann.text,
    onSave: (text) => {
      ann.text = text;
      ann.height = Math.max(ann.height, (ann.fontSize || 16) * 2.5);
      studioState.dirty = true;
      renderOverlay();
      renderAnnotationLayer();
    },
  });
}

function addTextAnnotationAt(point) {
  const pageIndex = getCurrentOriginalIndex();
  placeInlineTextEditor(point, {
    onSave: (text) => {
      addAnnotation(annotationStore, pageIndex, {
        type: "text",
        x: point.x,
        y: point.y,
        width: 260,
        height: Math.max(40, (annotationStore.textSize || 16) * 2.5),
        text,
        fontSize: annotationStore.textSize || 16,
        color: annotationStore.textColor,
      });
      studioState.dirty = true;
      renderOverlay();
      renderAnnotationLayer();
      setStatus("تمت إضافة النص — اضغط «حفظ في المكتبة» لتثبيته في PDF.", false);
    },
  });
}

function openTextDialog() {
  return new Promise((resolve) => {
    const dialog = document.getElementById("pdf-text-dialog");
    const input = document.getElementById("pdf-text-dialog-input");
    textDialogResolver = resolve;
    input.value = "";
    dialog?.classList.remove("hidden");
    input?.focus();
  });
}

function closeTextDialog(value = null) {
  document.getElementById("pdf-text-dialog")?.classList.add("hidden");
  textDialogResolver?.(value);
  textDialogResolver = null;
}

function openSignatureDialog() {
  return new Promise((resolve) => {
    const dialog = document.getElementById("pdf-signature-dialog");
    const pad = document.getElementById("pdf-signature-pad");
    signatureDialogResolver = resolve;
    const ctx = pad.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pad.width, pad.height);
    dialog?.classList.remove("hidden");
  });
}

function closeSignatureDialog(dataUrl = null) {
  document.getElementById("pdf-signature-dialog")?.classList.add("hidden");
  signatureDialogResolver?.(dataUrl);
  signatureDialogResolver = null;
}

function requestImageFile() {
  return new Promise((resolve) => {
    const input = document.getElementById("pdf-studio-image-input");
    input.onchange = () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ dataUrl: reader.result, width: img.width, height: img.height });
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

async function handleRotate() {
  const originalIndex = getCurrentOriginalIndex();
  studioState.rotations[originalIndex] = normalizeRotation((studioState.rotations[originalIndex] || 0) + 90);
  studioState.dirty = true;
  await renderCurrentPage();
}

async function handleDeletePage() {
  const visible = getVisibleIndices();
  if (visible.length <= 1 && !studioState.appendBuffers.length) {
    setStatus("لا يمكن حذف الصفحة الوحيدة.", true);
    return;
  }
  const originalIndex = getCurrentOriginalIndex();
  studioState.deletedPages.add(originalIndex);
  studioState.dirty = true;
  if (studioState.currentVisibleIndex >= visible.length - 1) {
    studioState.currentVisibleIndex = Math.max(0, visible.length - 2);
  }
  await renderCurrentPage();
  setStatus("تم حذف الصفحة من المسودة — اضغط «حفظ» لتطبيق التغييرات.");
}

async function handleOcrPage() {
  try {
    const originalIndex = getCurrentOriginalIndex();
    await ocrPage(originalIndex);
    studioState.dirty = true;
    setStatus(`تم استخراج نص الصفحة ${studioState.currentVisibleIndex + 1}.`, false);
    renderThumbnails();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleOcrAll() {
  const visible = getVisibleIndices();
  try {
    setStatus("جارٍ تجهيز Puter AI…");
    await ensurePuterConnected();
    for (let i = 0; i < visible.length; i += 1) {
      const originalIndex = visible[i];
      if (studioState.ocrTexts[originalIndex]) continue;
      await ocrPage(originalIndex);
    }
    studioState.dirty = true;
    setStatus(`تم استخراج النص من ${visible.length} صفحة.`, false);
    renderThumbnails();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleExtract() {
  try {
    const originalIndex = getCurrentOriginalIndex();
    const bytes = await extractPagesPdf(studioState.sourceBytes, [originalIndex], studioState.rotations);
    const base = studioState.filename.replace(/\.pdf$/i, "");
    downloadBytes(bytes, `${base}-صفحة-${studioState.currentVisibleIndex + 1}.pdf`);
    setStatus("تم تنزيل الصفحة المحددة.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleMergeFile(file) {
  if (!file) return;
  const buffer = new Uint8Array(await file.arrayBuffer());
  studioState.appendBuffers.push(buffer);
  studioState.dirty = true;
  setStatus(`تمت إضافة «${file.name}» للدمج — اضغط «حفظ» لتطبيق التغييرات.`);
  updateToolbarState();
}

async function handleMergeLibrary(docId) {
  if (!docId || docId === studioState.docId) return;
  const blob = await callbacks.getBlob?.(docId);
  if (!blob) throw new Error("تعذّر تحميل ملف الدمج.");
  const buffer = new Uint8Array(await blob.arrayBuffer());
  studioState.appendBuffers.push(buffer);
  studioState.dirty = true;
  setStatus("تمت إضافة الملف من المكتبة للدمج.", false);
  updateToolbarState();
}

async function handleDownload() {
  try {
    setStatus("جارٍ تجهيز التنزيل…");
    const bytes = await buildOutputBytes();
    downloadBytes(bytes, studioState.filename);
    setStatus("تم تنزيل الملف.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleSave() {
  try {
    setStatus("جارٍ حفظ التعديلات…");
    const bytes = await buildOutputBytes();
    const ocrText = studioState.hasNativeText ? null : collectOcrText() || null;
    await callbacks.onSave?.(studioState.docId, bytes, {
      ocrText,
      filename: studioState.filename,
    });
    studioState.sourceBytes = bytes;
    studioState.deletedPages = new Set();
    studioState.rotations = {};
    studioState.appendBuffers = [];
    studioState.pageViewports = {};
    annotationStore.byPage = {};
    annotationStore.selectedId = null;
    annotationStore.drawing = null;
    setActiveTool(annotationStore, EDIT_TOOLS.SELECT);
    setEditTool(EDIT_TOOLS.SELECT);
    studioState.ocrTexts = ocrText ? studioState.ocrTexts : {};
    studioState.dirty = false;
    studioState.pdfDoc = await loadPdfDocument(studioState.sourceBytes);
    studioState.totalPages = studioState.pdfDoc.numPages;
    studioState.currentVisibleIndex = 0;
    await renderCurrentPage();
    setStatus("تم حفظ التعديلات في المكتبة.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function bindSignaturePad() {
  const pad = document.getElementById("pdf-signature-pad");
  if (!pad) return;
  const ctx = pad.getContext("2d");
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";

  const point = (event) => {
    const rect = pad.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  pad.addEventListener("pointerdown", (event) => {
    signatureDrawing = true;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    pad.setPointerCapture(event.pointerId);
  });
  pad.addEventListener("pointermove", (event) => {
    if (!signatureDrawing) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  pad.addEventListener("pointerup", () => {
    signatureDrawing = false;
  });
}

function bindEvents() {
  modalEl.querySelector("#pdf-studio-close")?.addEventListener("click", closePdfStudio);
  modalEl.querySelector(".pdf-studio-backdrop")?.addEventListener("click", closePdfStudio);
  modalEl.querySelector("#pdf-studio-prev")?.addEventListener("click", () => {
    studioState.currentVisibleIndex -= 1;
    renderCurrentPage();
  });
  modalEl.querySelector("#pdf-studio-next")?.addEventListener("click", () => {
    studioState.currentVisibleIndex += 1;
    renderCurrentPage();
  });
  modalEl.querySelector("#pdf-studio-zoom-in")?.addEventListener("click", () => {
    studioState.zoom = Math.min(3, (studioState.zoom || 1) + 0.15);
    renderCurrentPage();
  });
  modalEl.querySelector("#pdf-studio-zoom-out")?.addEventListener("click", () => {
    studioState.zoom = Math.max(0.5, (studioState.zoom || 1) - 0.15);
    renderCurrentPage();
  });
  modalEl.querySelector("#pdf-studio-zoom-fit")?.addEventListener("click", () => {
    studioState.zoom = 1;
    renderCurrentPage();
  });
  modalEl.querySelector("#pdf-studio-rotate")?.addEventListener("click", () => handleRotate());
  modalEl.querySelector("#pdf-studio-delete-page")?.addEventListener("click", () => handleDeletePage());
  modalEl.querySelector("#pdf-studio-ocr-page")?.addEventListener("click", () => handleOcrPage());
  modalEl.querySelector("#pdf-studio-ocr-all")?.addEventListener("click", () => handleOcrAll());
  modalEl.querySelector("#pdf-studio-extract")?.addEventListener("click", () => handleExtract());
  modalEl.querySelector("#pdf-studio-download")?.addEventListener("click", () => handleDownload());
  modalEl.querySelector("#pdf-studio-save")?.addEventListener("click", () => handleSave());
  modalEl.querySelector("#pdf-studio-delete-annotation")?.addEventListener("click", () => {
    if (deleteSelectedAnnotation(annotationStore, getCurrentOriginalIndex())) {
      studioState.dirty = true;
      renderOverlay();
      renderAnnotationLayer();
      setStatus("تم حذف التحديد.");
    }
  });

  modalEl.querySelectorAll(".pdf-studio-tool").forEach((btn) => {
    btn.addEventListener("click", () => setEditTool(btn.dataset.tool));
  });

  modalEl.querySelector("#pdf-studio-text-size")?.addEventListener("input", (event) => {
    annotationStore.textSize = Number(event.target.value) || 16;
  });
  modalEl.querySelector("#pdf-studio-pen-color")?.addEventListener("input", (event) => {
    annotationStore.penColor = event.target.value;
  });

  modalEl.querySelector("#pdf-studio-merge-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    handleMergeFile(file).catch((error) => setStatus(error.message, true));
  });

  modalEl.querySelector("#pdf-studio-merge-library")?.addEventListener("change", (event) => {
    const docId = event.target.value;
    event.target.value = "";
    handleMergeLibrary(docId).catch((error) => setStatus(error.message, true));
  });

  document.getElementById("pdf-text-dialog-confirm")?.addEventListener("click", () => {
    const value = document.getElementById("pdf-text-dialog-input")?.value || "";
    closeTextDialog(value);
  });
  document.getElementById("pdf-text-dialog-cancel")?.addEventListener("click", () => closeTextDialog(null));
  document.getElementById("pdf-text-dialog-backdrop")?.addEventListener("click", () => closeTextDialog(null));

  document.getElementById("pdf-signature-confirm")?.addEventListener("click", () => {
    const pad = document.getElementById("pdf-signature-pad");
    closeSignatureDialog(pad?.toDataURL("image/png") || null);
  });
  document.getElementById("pdf-signature-cancel")?.addEventListener("click", () => closeSignatureDialog(null));
  document.getElementById("pdf-signature-backdrop")?.addEventListener("click", () => closeSignatureDialog(null));
  document.getElementById("pdf-signature-clear")?.addEventListener("click", () => {
    const pad = document.getElementById("pdf-signature-pad");
    const ctx = pad.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pad.width, pad.height);
  });

  bindSignaturePad();

  const overlay = modalEl.querySelector("#pdf-studio-overlay");
  bindAnnotationInteractions({
    overlay,
    getPageIndex: getCurrentOriginalIndex,
    getViewportMeta: () => studioState?.pageViewports?.[getCurrentOriginalIndex()] || null,
    store: annotationStore,
    onChange: () => {
      studioState.dirty = true;
      renderOverlay();
      renderAnnotationLayer();
    },
    onRequestInlineText: (point) => addTextAnnotationAt(point),
    onRequestImage: (callback) => {
      requestImageFile().then((result) => {
        if (result) callback(result.dataUrl, result.width, result.height);
      });
    },
    onRequestSignature: (callback) => {
      openSignatureDialog().then((dataUrl) => {
        if (dataUrl) callback(dataUrl, 180, 70);
      });
    },
  });

  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(event) {
  if (!modalEl || modalEl.classList.contains("hidden") || !studioState) return;
  if (event.key === "Escape") {
    if (!document.getElementById("pdf-text-dialog")?.classList.contains("hidden")) {
      closeTextDialog(null);
      return;
    }
    if (!document.getElementById("pdf-signature-dialog")?.classList.contains("hidden")) {
      closeSignatureDialog(null);
      return;
    }
    event.preventDefault();
    closePdfStudio();
  } else if (event.key === "ArrowLeft") {
    modalEl.querySelector("#pdf-studio-next")?.click();
  } else if (event.key === "ArrowRight") {
    modalEl.querySelector("#pdf-studio-prev")?.click();
  } else if ((event.key === "Delete" || event.key === "Backspace") && annotationStore.selectedId) {
    event.preventDefault();
    modalEl.querySelector("#pdf-studio-delete-annotation")?.click();
  }
}

function populateMergeLibrarySelect(documents) {
  const select = modalEl.querySelector("#pdf-studio-merge-library");
  if (!select) return;
  const pdfs = (documents || []).filter(
    (doc) => doc.id !== studioState?.docId && /\.pdf$/i.test(doc.filename || "")
  );
  select.innerHTML = `<option value="">دمج من المكتبة…</option>${pdfs
    .map(
      (doc) =>
        `<option value="${escapeHtml(doc.id)}">${escapeHtml(doc.filename)} — ${escapeHtml(doc.category || "عام")}</option>`
    )
    .join("")}`;
}

export function initPdfStudio(root, options = {}) {
  modalEl = root;
  callbacks = options;
  annotationStore = createAnnotationStore();
  bindEvents();
  setEditTool(EDIT_TOOLS.SELECT);
}

export async function openPdfStudio({ docId, filename, blob, libraryDocuments = [] }) {
  if (!modalEl) throw new Error("محرر PDF غير مهيأ.");

  setStatus("جارٍ تحميل PDF…");
  modalEl.classList.remove("hidden");
  document.body.classList.add("pdf-studio-open");

  const sourceBytes = new Uint8Array(await blob.arrayBuffer());
  const pdfDoc = await loadPdfDocument(sourceBytes);
  const hasNativeText = await pdfHasNativeText(pdfDoc);
  annotationStore.byPage = {};
  annotationStore.selectedId = null;
  annotationStore.drawing = null;
  setActiveTool(annotationStore, EDIT_TOOLS.SELECT);
  setEditTool(EDIT_TOOLS.SELECT);

  studioState = {
    docId,
    filename,
    sourceBytes,
    pdfDoc,
    hasNativeText,
    totalPages: pdfDoc.numPages,
    deletedPages: new Set(),
    rotations: {},
    ocrTexts: {},
    appendBuffers: [],
    pageViewports: {},
    currentVisibleIndex: 0,
    zoom: 1,
    dirty: false,
  };

  const titleEl = modalEl.querySelector("#pdf-studio-title");
  if (titleEl) titleEl.textContent = filename;

  populateMergeLibrarySelect(libraryDocuments);
  await renderCurrentPage();
  setStatus("");
}

export function closePdfStudio() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  document.body.classList.remove("pdf-studio-open");
  studioState = null;
  setStatus("");
}

export function isPdfStudioOpen() {
  return Boolean(studioState && modalEl && !modalEl.classList.contains("hidden"));
}
