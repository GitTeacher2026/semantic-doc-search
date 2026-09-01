import {
  extractImageText,
  ensurePuterConnected,
  formatOcrProgress,
  isImageFile,
} from "./ocr.js";
import { fileEndsWith } from "./constants.js";
import { extractPdfTextLayer } from "./pdf-utils.js";

/**
 * Extract indexable text from upload — Puter OCR for images only.
 * PDFs use the embedded text layer; scanned PDFs are stored without OCR.
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
    return { text: text.trim(), ocrUsed: false };
  }

  return { text: "", ocrUsed: false };
}

export { extractPdfTextLayer } from "./pdf-utils.js";
