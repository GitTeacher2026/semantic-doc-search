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

const MAX_EDGE = 1200;
const OCR_TIMEOUT_MS = 120000;

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1";
const TESSERACT_CORE_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0";

const TESS_OPTS = {
  workerPath: `${TESSERACT_CDN}/dist/worker.min.js`,
  corePath: `${TESSERACT_CORE_CDN}/tesseract-core.wasm.js`,
  langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
};

const STAGE_LABELS = {
  prepare: "جارٍ تحضير الصورة",
  load: "جارٍ تحميل محرك OCR",
  language: "جارٍ تحميل بيانات اللغة",
  ocr: "جارٍ قراءة النص من الصورة",
};

export function isImageFile(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function formatOcrProgress({ stage, pct } = {}) {
  const label = STAGE_LABELS[stage] || "جارٍ معالجة الصورة";
  if (stage === "ocr" || stage === "language" || stage === "load") {
    return `${label}: ${pct ?? 0}%`;
  }
  return label;
}

async function loadRecognize() {
  const mod = await import(`${TESSERACT_CDN}/+esm`);
  const recognize = mod.recognize ?? mod.default?.recognize;
  if (typeof recognize !== "function") {
    throw new Error("تعذّر تحميل محرك OCR.");
  }
  return recognize;
}

async function prepareImageBlob(blob) {
  if (!globalThis.createImageBitmap || !globalThis.document) {
    return blob;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_EDGE) {
      bitmap.close();
      return blob;
    }

    const scale = MAX_EDGE / longest;
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

    const resized = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("تعذّر تصغير الصورة."))),
        "image/jpeg",
        0.9
      );
    });
    return resized;
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
    .replace(/\s+/g, " ")
    .replace(/[^\S\u0600-\u06FFa-zA-Z0-9.,،؛:!?؟()\-+/]+/g, " ")
    .trim();
}

function buildLogger(onProgress) {
  return (message) => {
    if (!onProgress || !message?.status) return;
    const pct = Math.round((message.progress || 0) * 100);
    if (message.status === "loading tesseract core" || message.status === "initializing tesseract") {
      onProgress({ stage: "load", pct });
      return;
    }
    if (message.status === "loading language traineddata") {
      onProgress({ stage: "language", pct });
      return;
    }
    if (message.status === "recognizing text") {
      onProgress({ stage: "ocr", pct });
    }
  };
}

async function runRecognize(recognize, blob, lang, onProgress) {
  return withTimeout(
    recognize(blob, lang, {
      ...TESS_OPTS,
      logger: buildLogger(onProgress),
    }),
    OCR_TIMEOUT_MS,
    "استغرق استخراج النص وقتاً طويلاً. جرّب صورة أصغر أو أوضح."
  );
}

export async function extractImageText(file, onProgress) {
  const source = file instanceof Blob ? file : new Blob([file]);
  onProgress?.({ stage: "prepare", pct: 0 });

  const prepared = await prepareImageBlob(source);
  const recognize = await loadRecognize();

  onProgress?.({ stage: "load", pct: 0 });
  let result = await runRecognize(recognize, prepared, "ara", onProgress);
  let text = normalizeOcrText(result?.data?.text);

  if (text.length < 2) {
    onProgress?.({ stage: "language", pct: 0 });
    result = await runRecognize(recognize, prepared, "eng", onProgress);
    text = normalizeOcrText(result?.data?.text);
  }

  if (!text) {
    throw new Error("لم يُعثر على نص في الصورة. جرّب صورة أوضح، إضاءة أفضل، أو نص أكبر.");
  }

  return text;
}
