import {
  OCR_ENGINES,
  buildOcrEngineChain,
  getOcrEngineLabel,
  loadOcrOptions,
} from "./ocr-options.js";

const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";
const PADDLE_OCR_URL = "https://esm.sh/ppu-paddle-ocr@6.4.3/web";

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
const OCR_TIMEOUT_MS = 180_000;
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

const STAGE_LABELS = {
  prepare: "جارٍ تحضير الصورة",
  load: "جارٍ تحميل محرك OCR",
  upload: "جارٍ إرسال الصورة لخدمة OCR",
  ocr: "جارٍ استخراج النص من الصورة",
};

let workerPromise = null;
let puterPromise = null;
let paddleServicePromise = null;
let activeProgressCallback = null;

export { getAvailableOcrEngines, loadOcrOptions, saveOcrOptions, OCR_ENGINES } from "./ocr-options.js";

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
    return `تعذّر المحرك السابق — جارٍ تجربة ${engineLabel || "محرك آخر"}…`;
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

async function blobToCanvas(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close();
    throw new Error("تعذّر تحضير الصورة لمحرك PaddleOCR.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
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

async function loadPuter() {
  if (globalThis.puter?.ai?.img2txt) {
    return globalThis.puter;
  }
  if (!puterPromise) {
    puterPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="js.puter.com"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(globalThis.puter), { once: true });
        existing.addEventListener("error", () => reject(new Error("تعذّر تحميل Puter OCR.")), {
          once: true,
        });
        return;
      }
      const script = document.createElement("script");
      script.src = PUTER_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve(globalThis.puter);
      script.onerror = () => reject(new Error("تعذّر تحميل Puter OCR."));
      document.head.appendChild(script);
    });
  }

  const puter = await puterPromise;
  if (!puter?.ai?.img2txt) {
    throw new Error("Puter OCR غير متاح في هذا المتصفح.");
  }
  return puter;
}

async function ocrWithPuter(blob) {
  activeProgressCallback?.({ stage: "load", pct: 15, engine: OCR_ENGINES.PUTER });
  const puter = await loadPuter();
  activeProgressCallback?.({ stage: "upload", pct: 35, engine: OCR_ENGINES.PUTER });

  const providers = ["mistral", "aws-textract"];
  let lastError = null;

  for (const provider of providers) {
    try {
      activeProgressCallback?.({ stage: "ocr", pct: 60, engine: OCR_ENGINES.PUTER });
      const text = await puter.ai.img2txt(blob, { provider });
      const normalized = String(text || "").trim();
      if (!normalized) {
        throw new Error("لم يُعثر Puter على نص في الصورة.");
      }
      activeProgressCallback?.({ stage: "ocr", pct: 100, engine: OCR_ENGINES.PUTER });
      return normalized;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("تعذّر استخراج النص عبر Puter AI.");
}

async function getPaddleService() {
  if (!paddleServicePromise) {
    paddleServicePromise = (async () => {
      activeProgressCallback?.({ stage: "load", pct: 8, engine: OCR_ENGINES.PADDLE });
      const { PaddleOcrService, V5_ARABIC_MOBILE_MODEL } = await import(PADDLE_OCR_URL);
      const service = new PaddleOcrService({ model: V5_ARABIC_MOBILE_MODEL });
      await service.initialize();
      return service;
    })();
  }
  return paddleServicePromise;
}

async function ocrWithPaddle(blob) {
  activeProgressCallback?.({ stage: "load", pct: 12, engine: OCR_ENGINES.PADDLE });
  const service = await getPaddleService();
  activeProgressCallback?.({ stage: "ocr", pct: 35, engine: OCR_ENGINES.PADDLE });
  const canvas = await blobToCanvas(blob);
  const result = await service.recognize(canvas, { flatten: true });
  const text = String(result?.text || "").trim();
  if (!text) {
    throw new Error("لم يُعثر PaddleOCR على نص في الصورة.");
  }
  activeProgressCallback?.({ stage: "ocr", pct: 100, engine: OCR_ENGINES.PADDLE });
  return text;
}

async function runOcrEngine(engine, blob) {
  if (engine === OCR_ENGINES.PUTER) {
    return ocrWithPuter(blob);
  }
  if (engine === OCR_ENGINES.PADDLE) {
    return ocrWithPaddle(blob);
  }
  return ocrWithTesseract(blob);
}

export async function extractImageText(file, onProgress, options = {}) {
  activeProgressCallback = onProgress;
  const preferred = options.engine || loadOcrOptions().engine;
  const enginesToTry = buildOcrEngineChain(preferred);
  const primary = enginesToTry[0] || OCR_ENGINES.TESSERACT;

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
