import { fileEndsWith } from "./constants.js";
import { extractPdfTextLayer } from "./pdf-utils.js";

const NATIVE_TEXT_MIN_CHARS = 40;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.length ? chunks : [text || ""];
}

export function applyNativePdfIndex(doc, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length < NATIVE_TEXT_MIN_CHARS) return false;
  doc.charCount = trimmed.length;
  doc.preview = trimmed.replace(/\s+/g, " ").slice(0, 280);
  doc.chunks = chunkText(trimmed).map((content) => ({ content }));
  doc.ocrExtracted = false;
  return true;
}

export async function extractNativePdfIndexText(bytes) {
  const buffer = bytes?.buffer ? bytes.buffer.slice(0) : bytes;
  const text = await extractPdfTextLayer(buffer);
  return text.trim();
}

export async function reindexPdfDocumentFromNativeLayer(doc, getBlob) {
  if (!doc || !fileEndsWith(doc.filename, ".pdf")) return false;
  const blob = await getBlob(doc);
  if (!blob) return false;
  const text = await extractNativePdfIndexText(await blob.arrayBuffer());
  if (!text || text.length < NATIVE_TEXT_MIN_CHARS) return false;
  applyNativePdfIndex(doc, text);
  return true;
}

export async function migratePdfIndexes(documents, getBlob) {
  let changed = false;
  for (const doc of documents) {
    if (!fileEndsWith(doc?.filename, ".pdf")) continue;
    if (doc.ocrExtracted !== true && doc.ocrExtracted !== "true") continue;
    try {
      if (await reindexPdfDocumentFromNativeLayer(doc, getBlob)) {
        changed = true;
      }
    } catch {
      /* skip unreadable files during migration */
    }
  }
  return changed;
}
