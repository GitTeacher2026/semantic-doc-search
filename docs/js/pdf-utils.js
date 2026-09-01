let pdfjsLib = null;
let pdfLibModule = null;

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

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

export function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export async function loadPdfDocument(bytes) {
  const pdfjs = await getPdfJs();
  const data = toArrayBuffer(bytes);
  return pdfjs.getDocument({ data }).promise;
}

export async function renderPageToCanvas(pdfDoc, pageNumber, canvas, { scale = 1.5, rotation = 0 } = {}) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

export async function renderPageToBlob(pdfDoc, pageNumber, options = {}) {
  const canvas = document.createElement("canvas");
  await renderPageToCanvas(pdfDoc, pageNumber, canvas, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذّر تحضير صورة الصفحة."))),
      "image/jpeg",
      0.9
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

export async function buildEditedPdf(
  sourceBytes,
  { deletedPages = new Set(), rotations = {}, appendBuffers = [] } = {}
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
    copied.forEach((page, idx) => {
      const originalIndex = kept[idx];
      const rot = rotations[originalIndex] || 0;
      if (rot) page.setRotation(degrees(rot));
      out.addPage(page);
    });
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
