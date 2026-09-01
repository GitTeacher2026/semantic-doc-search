import {
  buildEditedPdf,
  extractPagesPdf,
  getActivePageIndices,
  loadPdfDocument,
  renderPageToBlob,
  renderPageToCanvas,
} from "./pdf-utils.js";
import { ensurePuterConnected, extractImageText, formatOcrProgress } from "./ocr.js";

let modalEl = null;
let callbacks = {};
let studioState = null;

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

async function renderCurrentPage() {
  if (!studioState?.pdfDoc) return;
  const canvas = modalEl.querySelector("#pdf-studio-canvas");
  const visible = getVisibleIndices();
  if (!visible.length) {
    canvas.width = 0;
    canvas.height = 0;
    return;
  }

  const originalIndex = getCurrentOriginalIndex();
  const rotation = studioState.rotations[originalIndex] || 0;
  studioState.currentVisibleIndex = Math.min(studioState.currentVisibleIndex, visible.length - 1);

  await renderPageToCanvas(studioState.pdfDoc, originalIndex + 1, canvas, {
    scale: studioState.scale,
    rotation,
  });

  const pageLabel = modalEl.querySelector("#pdf-studio-page-label");
  if (pageLabel) {
    pageLabel.textContent = `صفحة ${studioState.currentVisibleIndex + 1} من ${visible.length}`;
  }
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
      const active = visibleIndex === studioState.currentVisibleIndex ? " is-active" : "";
      return `
        <button
          type="button"
          class="pdf-studio-thumb${active}"
          data-visible-index="${visibleIndex}"
          title="صفحة ${visibleIndex + 1}${ocr ? " — نص مستخرج" : ""}"
        >
          <span class="pdf-studio-thumb-num">${visibleIndex + 1}</span>
          ${rot ? `<span class="pdf-studio-thumb-rot">${rot}°</span>` : ""}
          ${ocr ? '<span class="pdf-studio-thumb-ocr" aria-hidden="true">📝</span>' : ""}
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
  modalEl.querySelector("#pdf-studio-prev")?.toggleAttribute("disabled", !hasPages || studioState.currentVisibleIndex <= 0);
  modalEl.querySelector("#pdf-studio-next")?.toggleAttribute(
    "disabled",
    !hasPages || studioState.currentVisibleIndex >= visible.length - 1
  );
  modalEl.querySelector("#pdf-studio-delete-page")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-rotate")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-ocr-page")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-ocr-all")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-extract")?.toggleAttribute("disabled", !hasPages);
  modalEl.querySelector("#pdf-studio-save")?.toggleAttribute("disabled", !hasPages && !studioState.appendBuffers.length);
}

async function buildOutputBytes() {
  return buildEditedPdf(studioState.sourceBytes, {
    deletedPages: studioState.deletedPages,
    rotations: studioState.rotations,
    appendBuffers: studioState.appendBuffers,
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
    scale: 2,
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
  const parts = visible
    .map((index) => studioState.ocrTexts[index])
    .filter(Boolean);
  return parts.join("\n\n").trim();
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
    const ocrText = collectOcrText();
    await callbacks.onSave?.(studioState.docId, bytes, {
      ocrText: ocrText || null,
      filename: studioState.filename,
    });
    studioState.sourceBytes = bytes;
    studioState.deletedPages = new Set();
    studioState.rotations = {};
    studioState.appendBuffers = [];
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
  modalEl.querySelector("#pdf-studio-rotate")?.addEventListener("click", () => handleRotate());
  modalEl.querySelector("#pdf-studio-delete-page")?.addEventListener("click", () => handleDeletePage());
  modalEl.querySelector("#pdf-studio-ocr-page")?.addEventListener("click", () => handleOcrPage());
  modalEl.querySelector("#pdf-studio-ocr-all")?.addEventListener("click", () => handleOcrAll());
  modalEl.querySelector("#pdf-studio-extract")?.addEventListener("click", () => handleExtract());
  modalEl.querySelector("#pdf-studio-download")?.addEventListener("click", () => handleDownload());
  modalEl.querySelector("#pdf-studio-save")?.addEventListener("click", () => handleSave());

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

  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(event) {
  if (!modalEl || modalEl.classList.contains("hidden") || !studioState) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closePdfStudio();
  } else if (event.key === "ArrowLeft") {
    modalEl.querySelector("#pdf-studio-next")?.click();
  } else if (event.key === "ArrowRight") {
    modalEl.querySelector("#pdf-studio-prev")?.click();
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
  bindEvents();
}

export async function openPdfStudio({ docId, filename, blob, libraryDocuments = [] }) {
  if (!modalEl) throw new Error("محرر PDF غير مهيأ.");

  setStatus("جارٍ تحميل PDF…");
  modalEl.classList.remove("hidden");
  document.body.classList.add("pdf-studio-open");

  const sourceBytes = new Uint8Array(await blob.arrayBuffer());
  const pdfDoc = await loadPdfDocument(sourceBytes);

  studioState = {
    docId,
    filename,
    sourceBytes,
    pdfDoc,
    totalPages: pdfDoc.numPages,
    deletedPages: new Set(),
    rotations: {},
    ocrTexts: {},
    appendBuffers: [],
    currentVisibleIndex: 0,
    scale: 1.35,
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
