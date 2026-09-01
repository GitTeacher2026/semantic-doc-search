import {
  extractImageText,
  ensurePuterConnected,
  formatOcrProgress,
  isImageFile,
} from "./ocr.js";
import { fileEndsWith } from "./constants.js";
import { loadPdfDocument, renderPageToBlob } from "./pdf-utils.js";

const MIN_PDF_TEXT_CHARS = 60;

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

async function ocrPdfPages(fileBytes, onStatus) {
  await ensurePuterConnected();
  const pdfDoc = await loadPdfDocument(new Uint8Array(fileBytes));
  const parts = [];
  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    onStatus?.(`جارٍ OCR للصفحة ${i} من ${pdfDoc.numPages}…`);
    const blob = await renderPageToBlob(pdfDoc, i, { scale: 2.2 });
    const result = await extractImageText(blob, (progress) => {
      onStatus?.(`${formatOcrProgress(progress)} — صفحة ${i}`);
    });
    const text = typeof result === "string" ? result : result.text;
    if (text?.trim()) parts.push(text.trim());
  }
  return parts.join("\n\n").trim();
}

/**
 * Extract indexable text from upload — uses PDF text layer when rich enough,
 * otherwise Puter OCR for scanned PDFs and all images.
 */
export async function extractIndexableText(file, fileBytes, onStatus) {
  const name = String(file?.name || "");
  const buffer = fileBytes?.buffer ? fileBytes.buffer.slice(0) : fileBytes;

  if (isImageFile(name)) {
    onStatus?.(`جارٍ استخراج النص من ${name}…`);
    await ensurePuterConnected();
    const blob = file instanceof Blob ? file : new Blob([fileBytes]);
    const result = await extractImageText(blob, (progress) => {
      onStatus?.(formatOcrProgress(progress));
    });
    const text = typeof result === "string" ? result : result.text;
    return { text: text?.trim() || "", ocrUsed: true };
  }

  if (fileEndsWith(name, ".pdf")) {
    onStatus?.(`جارٍ قراءة نص ${name}…`);
    let text = "";
    try {
      text = await extractPdfTextLayer(buffer);
    } catch {
      text = "";
    }

    if (text.trim().length >= MIN_PDF_TEXT_CHARS) {
      return { text: text.trim(), ocrUsed: false };
    }

    onStatus?.(`PDF ممسوح ضوئياً — جارٍ OCR لـ ${name}…`);
    const ocrText = await ocrPdfPages(fileBytes, onStatus);
    if (ocrText) return { text: ocrText, ocrUsed: true };
    return { text: text.trim(), ocrUsed: Boolean(text.trim()) };
  }

  return { text: "", ocrUsed: false };
}
