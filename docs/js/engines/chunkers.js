const FIXED_SIZE = 800;
const FIXED_OVERLAP = 120;
const LARGE_SIZE = 2000;
const LARGE_OVERLAP = 200;

function splitFixed(text, size, overlap) {
  const chunks = [];
  const clean = String(text || "").trim();
  if (!clean) return [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + size);
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function splitParagraphs(text) {
  const parts = String(text || "")
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length) return splitFixed(text, FIXED_SIZE, FIXED_OVERLAP);
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    if (!buffer) {
      buffer = part;
      continue;
    }
    if ((buffer + "\n\n" + part).length <= LARGE_SIZE) {
      buffer = `${buffer}\n\n${part}`;
    } else {
      chunks.push(buffer);
      buffer = part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function splitSentences(text) {
  const parts = String(text || "")
    .split(/(?<=[.!?؟…])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 12);
  if (!parts.length) return splitParagraphs(text);
  const chunks = [];
  let buffer = "";
  for (const part of parts) {
    if (!buffer) {
      buffer = part;
      continue;
    }
    if ((`${buffer} ${part}`).length <= FIXED_SIZE) {
      buffer = `${buffer} ${part}`;
    } else {
      chunks.push(buffer);
      buffer = part;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export function chunkDocument(engineId, text) {
  switch (engineId) {
    case "paragraph":
      return splitParagraphs(text);
    case "sentence":
      return splitSentences(text);
    case "large":
      return splitFixed(text, LARGE_SIZE, LARGE_OVERLAP);
    case "fixed":
    default:
      return splitFixed(text, FIXED_SIZE, FIXED_OVERLAP);
  }
}
