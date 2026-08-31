import { OCR_ENGINES, getOcrFallbackEngine, getOcrEngineLabel, loadOcrOptions, resolveOcrEngine } from "./ocr-options.js";
import { hydrateOcrSpaceKey } from "./ocr-config.js";

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
  upload: "جارٍ إرسال الصورة لخدمة OCR",
  ocr: "جارٍ استخراج النص من الصورة",
};

let workerPromise = null;
let activeProgressCallback = null;

export { getAvailableOcrEngines, loadOcrOptions, saveOcrOptions, OCR_ENGINES } from "./ocr-options.js";
export { hydrateOcrSpaceKey } from "./ocr-config.js";

export function isImageFile(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function formatOcrProgress({ stage, pct, engine, fallbackReason } = {}) {
  const engineLabel = engine ? getOcrEngineLabel(engine).split("—").pop()?.trim() : "";
  const prefix = engineLabel ? `${engineLabel}: ` : "";
  const label = STAGE_LABELS[stage] || "جارٍ معالجة الصورة";
  if (fallbackReason && stage === "load") {
    return "OCR.space غير متاح — جارٍ استخدام Tesseract المحلي…";
  }
  if (stage === "load" || stage === "ocr" || stage === "upload") {
    return `${prefix}${label}${typeof pct === "number" ? `: ${pct}%` : "…"}`;
  }
  return `${prefix}${label}`;
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
    activeProgressCallback?.({ stage: "load", pct, engine: OCR_ENGINES.TESSERACT });
    return;
  }
  if (status === "recognizing text") {
    activeProgressCallback?.({ stage: "ocr", pct, engine: OCR_ENGINES.TESSERACT });
  }
}

async function loadTesseract() {
  const mod = await import(TESSERACT_URL);
  const api = mod.default ?? mod;
  if (typeof api?.createWorker !== "function") {
    throw new Error("تعذّر تحميل محرك OCR المحلي.");
  }
  return api;
}

async function getTesseractWorker() {
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

async function ocrWithTesseract(blob) {
  activeProgressCallback?.({ stage: "load", pct: 5, engine: OCR_ENGINES.TESSERACT });
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(blob);
  activeProgressCallback?.({ stage: "ocr", pct: 100, engine: OCR_ENGINES.TESSERACT });
  return data.text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientOcrSpaceError(error, status = 0) {
  const code = Number(status || error?.status || 0);
  const text = String(error?.message || "").toLowerCase();
  return (
    code === 503 ||
    code === 502 ||
    code === 429 ||
    code === 500 ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("429") ||
    text.includes("unavailable") ||
    text.includes("timeout") ||
    text.includes("network")
  );
}

async function requestOcrSpace(blob, apiKey, engineVersion) {
  const form = new FormData();
  form.append("apikey", apiKey);
  form.append("language", "ara");
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", String(engineVersion));
  form.append("file", blob, "image.jpg");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: form,
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const error = new Error(
      payload?.ErrorMessage?.[0] ||
        payload?.message ||
        payload?.error ||
        `OCR.space غير متاح حالياً (${res.status})`
    );
    error.status = res.status;
    throw error;
  }

  if (payload.IsErroredOnProcessing) {
    const error = new Error(
      payload.ErrorMessage?.[0] ||
        payload.ErrorDetails ||
        "تعذّر معالجة الصورة عبر OCR.space."
    );
    error.status = 503;
    throw error;
  }

  return (payload.ParsedResults || [])
    .map((item) => item.ParsedText || "")
    .join("\n")
    .trim();
}

async function ocrWithOcrSpace(blob) {
  const apiKey = await hydrateOcrSpaceKey();
  if (!apiKey) {
    throw new Error("مفتاح OCR.space غير مضبوط. أضف OCR_SPACE_API_KEY في GitHub Secrets ثم أعد النشر.");
  }

  activeProgressCallback?.({ stage: "upload", pct: 25, engine: OCR_ENGINES.OCR_SPACE });

  const attempts = [
    { engine: 2, delayMs: 0 },
    { engine: 2, delayMs: 1500 },
    { engine: 1, delayMs: 0 },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    if (attempt.delayMs) {
      await sleep(attempt.delayMs);
    }
    try {
      activeProgressCallback?.({ stage: "ocr", pct: 50, engine: OCR_ENGINES.OCR_SPACE });
      const text = await requestOcrSpace(blob, apiKey, attempt.engine);
      activeProgressCallback?.({ stage: "ocr", pct: 100, engine: OCR_ENGINES.OCR_SPACE });
      return text;
    } catch (error) {
      lastError = error;
      if (!isTransientOcrSpaceError(error, error.status)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("OCR.space غير متاح حالياً.");
}

async function runOcrEngine(engine, blob) {
  if (engine === OCR_ENGINES.OCR_SPACE) {
    return ocrWithOcrSpace(blob);
  }
  return ocrWithTesseract(blob);
}

export async function extractImageText(file, onProgress, options = {}) {
  await hydrateOcrSpaceKey();
  activeProgressCallback = onProgress;
  const preferred = options.engine || loadOcrOptions().engine;
  const primary = resolveOcrEngine(preferred);

  const enginesToTry = [primary];
  if (primary === OCR_ENGINES.OCR_SPACE) {
    enginesToTry.push(OCR_ENGINES.TESSERACT);
  } else {
    const autoFallback = getOcrFallbackEngine(primary, preferred === OCR_ENGINES.AUTO);
    if (autoFallback) enginesToTry.push(autoFallback);
  }

  try {
    const source = file instanceof Blob ? file : new Blob([file]);
    onProgress?.({ stage: "prepare", pct: 0, engine: primary });

    const prepared = await prepareImageBlob(source);
    let lastError = null;

    for (const engine of enginesToTry) {
      try {
        if (engine !== primary && lastError) {
          onProgress?.({
            stage: "load",
            pct: 0,
            engine,
            fallbackReason: lastError.message,
          });
        }

        const text = normalizeOcrText(
          await withTimeout(
            runOcrEngine(engine, prepared),
            OCR_TIMEOUT_MS,
            "استغرق استخراج النص وقتاً طويلاً. جرّب صورة أصغر أو محرك OCR آخر."
          )
        );

        if (!text || text.length < 2) {
          throw new Error("لم يُعثر على نص في الصورة.");
        }

        return {
          text,
          engine,
          fallbackFrom: engine !== primary ? primary : null,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("تعذّر استخراج النص من الصورة.");
  } finally {
    activeProgressCallback = null;
  }
}
