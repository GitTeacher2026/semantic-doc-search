const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);

const MAX_EDGE = 2000;
const OCR_TIMEOUT_MS = 120_000;
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

const STAGE_LABELS = {
  prepare: "جارٍ تحضير الصورة",
  load: "جارٍ تحميل محرك OCR",
  ocr: "جارٍ استخراج النص من الصورة",
};

let workerPromise = null;
let activeProgressCallback = null;

export function isImageFile(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function formatOcrProgress({ stage, pct } = {}) {
  const label = STAGE_LABELS[stage] || "جارٍ معالجة الصورة";
  if (stage === "load" || stage === "ocr") {
    return `${label}${typeof pct === "number" ? `: ${pct}%` : "…"}`;
  }
  return label;
}

async function prepareImageBlob(blob) {
  if (!globalThis.createImageBitmap || !globalThis.document) {
    return blob;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      bitmap.close();
      return blob;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("تعذّر تصغير الصورة."))),
        "image/jpeg",
        0.92
      );
    });
  } catch {
    return blob;
  }
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function mapTesseractProgress(message) {
  const status = String(message?.status || "");
  const pct = Math.round((message?.progress || 0) * 100);
  if (
    status.includes("loading tesseract") ||
    status.includes("initializing api") ||
    status.includes("loading language")
  ) {
    activeProgressCallback?.({ stage: "load", pct });
    return;
  }
  if (status === "recognizing text") {
    activeProgressCallback?.({ stage: "ocr", pct });
  }
}

async function loadTesseract() {
  const mod = await import(TESSERACT_URL);
  const api = mod.default ?? mod;
  if (typeof api?.createWorker !== "function") {
    throw new Error("تعذّر تحميل محرك OCR. حدّث الصفحة وحاول مرة أخرى.");
  }
  return api;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await loadTesseract();
      return createWorker("ara+eng", 1, {
        logger: mapTesseractProgress,
      });
    })();
  }
  return workerPromise;
}

export async function extractImageText(file, onProgress) {
  activeProgressCallback = onProgress;
  try {
    const source = file instanceof Blob ? file : new Blob([file]);
    onProgress?.({ stage: "prepare", pct: 0 });

    const prepared = await prepareImageBlob(source);
    onProgress?.({ stage: "load", pct: 5 });

    const text = normalizeOcrText(
      await withTimeout(
        (async () => {
          const worker = await getWorker();
          const { data } = await worker.recognize(prepared);
          return data.text;
        })(),
        OCR_TIMEOUT_MS,
        "استغرق استخراج النص وقتاً طويلاً. جرّب صورة أصغر أو أوضح."
      )
    );

    onProgress?.({ stage: "ocr", pct: 100 });

    if (!text || text.length < 2) {
      throw new Error("لم يُعثر على نص في الصورة. جرّب صورة أوضح، إضاءة أفضل، أو نص أكبر.");
    }

    return text;
  } finally {
    activeProgressCallback = null;
  }
}
