let pdfjsLib = null;
let pdfLibModule = null;
let arabicFontBytes = null;

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFJS_URL = `${PDFJS_BASE}/build/pdf.min.mjs`;
const PDFJS_WORKER = `${PDFJS_BASE}/build/pdf.worker.min.mjs`;
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";
const ARABIC_FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@v2024.10.18/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf";

export const DEFAULT_RENDER_SCALE = 1.5;

export function getPdfDocumentOptions(data) {
  return {
    data: toArrayBuffer(data),
    useSystemFonts: true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    cMapUrl: `${PDFJS_BASE}/cmaps/`,
    cMapPacked: true,
  };
}

export async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return pdfjsLib;
}

export async function getPdfLib() {
  if (!pdfLibModule) {
    pdfLibModule = await import(PDFLIB_URL);
  }
  return pdfLibModule;
}

export async function getArabicFontBytes() {
  if (!arabicFontBytes) {
    const response = await fetch(ARABIC_FONT_URL);
    if (!response.ok) throw new Error("تعذّر تحميل خط العربية للمحرر.");
    arabicFontBytes = await response.arrayBuffer();
  }
  return arabicFontBytes;
}

export function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export async function extractPdfTextLayer(arrayBuffer) {
  const pdf = await loadPdfDocument(arrayBuffer);
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str).join(" "));
    page.cleanup?.();
  }
  return parts.join("\n").trim();
}

const NATIVE_TEXT_MIN_CHARS = 40;

export async function pdfHasNativeText(pdfDoc, minChars = NATIVE_TEXT_MIN_CHARS) {
  let total = 0;
  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      total += String(item.str || "").trim().length;
      if (total >= minChars) {
        page.cleanup?.();
        return true;
      }
    }
    page.cleanup?.();
  }
  return false;
}

export async function pageHasNativeText(pdfDoc, pageNumber, minChars = 8) {
  const page = await pdfDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  const length = content.items.reduce((sum, item) => sum + String(item.str || "").trim().length, 0);
  page.cleanup?.();
  return length >= minChars;
}

export async function loadPdfDocument(bytes) {
  const pdfjs = await getPdfJs();
  return pdfjs.getDocument(getPdfDocumentOptions(bytes)).promise;
}

/**
 * Hi-DPI PDF render — fixes blurry text on Retina / high-DPI screens.
 */
export async function renderPageToCanvas(pdfDoc, pageNumber, canvas, options = {}) {
  const {
    scale = DEFAULT_RENDER_SCALE,
    rotation = 0,
    devicePixelRatio = window.devicePixelRatio || 1,
  } = options;

  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation });
  const outputScale = Math.min(Math.max(devicePixelRatio, 1), 3);

  const cssWidth = Math.floor(viewport.width);
  const cssHeight = Math.floor(viewport.height);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(outputScale, outputScale);

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
    intent: "display",
  });
  await renderTask.promise;
  page.cleanup?.();

  return {
    viewport,
    cssWidth,
    cssHeight,
    outputScale,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
  };
}

export async function renderTextLayer(pdfDoc, pageNumber, container, viewport) {
  if (!container) return;
  container.innerHTML = "";
  container.style.width = `${Math.floor(viewport.width)}px`;
  container.style.height = `${Math.floor(viewport.height)}px`;

  const pdfjs = await getPdfJs();
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();

  const textItems = textContent.items.filter((item) => item.str?.trim());
  if (!textItems.length) {
    page.cleanup?.();
    return;
  }

  const Util = pdfjs.Util;
  for (const item of textItems) {
    const transform = Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1], transform[0]);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const left = transform[4];
    const top = transform[5] - fontHeight;

    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.position = "absolute";
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.lineHeight = "1";
    span.style.fontFamily = "sans-serif";
    span.style.transform = `rotate(${angle}rad)`;
    span.style.transformOrigin = "0 0";
    span.style.whiteSpace = "pre";
    span.style.color = "transparent";
    span.style.webkitTextFillColor = "transparent";
    span.setAttribute("role", "presentation");
    container.appendChild(span);
  }

  page.cleanup?.();
}

export async function renderPageToBlob(pdfDoc, pageNumber, options = {}) {
  const canvas = document.createElement("canvas");
  await renderPageToCanvas(pdfDoc, pageNumber, canvas, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذّر تحضير صورة الصفحة."))),
      "image/png",
      1
    );
  });
}

export function getActivePageIndices(totalPages, deletedPages) {
  const indices = [];
  for (let i = 0; i < totalPages; i += 1) {
    if (!deletedPages.has(i)) indices.push(i);
  }
  return indices;
}

function hexToRgb(hex) {
  const normalized = String(hex || "#000000").replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function viewportRectToPdf(rect, vp, pageHeight) {
  const scaleX = vp.pdfWidth / vp.width;
  const scaleY = vp.pdfHeight / vp.height;
  const x = rect.x * scaleX;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;
  const y = pageHeight - (rect.y + rect.height) * scaleY;
  return { x, y, width, height };
}

async function drawAnnotationOnPage(pdfDoc, page, annotation, vp, rgbFont) {
  const { rgb } = await getPdfLib();
  const { height: pageHeight } = page.getSize();

  if (annotation.type === "highlight") {
    const box = viewportRectToPdf(annotation, vp, pageHeight);
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: rgb(1, 0.92, 0.23),
      opacity: 0.45,
    });
    return;
  }

  if (annotation.type === "whiteout") {
    const box = viewportRectToPdf(annotation, vp, pageHeight);
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
    return;
  }

  if (annotation.type === "rect") {
    const box = viewportRectToPdf(annotation, vp, pageHeight);
    const stroke = hexToRgb(annotation.color || "#2563eb");
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      borderColor: rgb(stroke.r, stroke.g, stroke.b),
      borderWidth: 1.5,
      opacity: 1,
    });
    return;
  }

  if (annotation.type === "text" && annotation.text) {
    const box = viewportRectToPdf(annotation, vp, pageHeight);
    const color = hexToRgb(annotation.color || "#111827");
    page.drawText(annotation.text, {
      x: box.x,
      y: box.y + box.height * 0.75,
      size: annotation.fontSize || 14,
      font: rgbFont,
      color: rgb(color.r, color.g, color.b),
      maxWidth: box.width,
      lineHeight: (annotation.fontSize || 14) * 1.25,
    });
    return;
  }

  if (
    (annotation.type === "pen" || annotation.type === "signature" || annotation.type === "image") &&
    annotation.dataUrl
  ) {
    const box = viewportRectToPdf(annotation, vp, pageHeight);
    const bytes = Uint8Array.from(atob(annotation.dataUrl.split(",")[1] || ""), (c) => c.charCodeAt(0));
    const isPng = annotation.dataUrl.startsWith("data:image/png");
    const image = isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    page.drawImage(image, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }
}

async function applyAnnotations(pdfDoc, pageIndexInOutput, originalPageIndex, annotations, pageViewports) {
  if (!annotations?.length) return;
  const vp = pageViewports[originalPageIndex];
  if (!vp) return;

  const page = pdfDoc.getPage(pageIndexInOutput);
  const fontBytes = await getArabicFontBytes();
  const font = await pdfDoc.embedFont(fontBytes);

  for (const annotation of annotations) {
    await drawAnnotationOnPage(pdfDoc, page, annotation, vp, font);
  }
}

export async function buildEditedPdf(
  sourceBytes,
  { deletedPages = new Set(), rotations = {}, appendBuffers = [], annotationsByPage = {}, pageViewports = {} } = {}
) {
  const { PDFDocument, degrees } = await getPdfLib();
  const src = await PDFDocument.load(sourceBytes);
  const out = await PDFDocument.create();
  const kept = getActivePageIndices(src.getPageCount(), deletedPages);

  if (!kept.length && !appendBuffers.length) {
    throw new Error("لا توجد صفحات للحفظ.");
  }

  if (kept.length) {
    const copied = await out.copyPages(src, kept);
    for (let idx = 0; idx < copied.length; idx += 1) {
      const page = copied[idx];
      const originalIndex = kept[idx];
      const rot = rotations[originalIndex] || 0;
      if (rot) page.setRotation(degrees(rot));
      out.addPage(page);
      await applyAnnotations(out, idx, originalIndex, annotationsByPage[originalIndex], pageViewports);
    }
  }

  for (const buffer of appendBuffers) {
    const other = await PDFDocument.load(buffer);
    const otherPages = await out.copyPages(other, other.getPageIndices());
    otherPages.forEach((page) => out.addPage(page));
  }

  return new Uint8Array(await out.save());
}

export async function extractPagesPdf(sourceBytes, pageIndices, rotations = {}) {
  const { PDFDocument, degrees } = await getPdfLib();
  const src = await PDFDocument.load(sourceBytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageIndices);
  copied.forEach((page, idx) => {
    const originalIndex = pageIndices[idx];
    const rot = rotations[originalIndex] || 0;
    if (rot) page.setRotation(degrees(rot));
    out.addPage(page);
  });
  return new Uint8Array(await out.save());
}
