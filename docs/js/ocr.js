import { GEMINI_API_KEY } from "./config.js";

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

const MAX_EDGE = 1600;
const OCR_TIMEOUT_MS = 45_000;
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const STAGE_LABELS = {
  prepare: "جارٍ تحضير الصورة",
  upload: "جارٍ إرسال الصورة لـ Google AI",
  ocr: "جارٍ استخراج النص من الصورة",
};

const OCR_PROMPT =
  "Extract every visible word from this image exactly as shown (like Google Lens). " +
  "Return raw text only in reading order. Support Arabic and English. No commentary.";

let cachedApiKey = null;

export function isImageFile(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function formatOcrProgress({ stage, pct } = {}) {
  const label = STAGE_LABELS[stage] || "جارٍ معالجة الصورة";
  if (stage === "ocr" || stage === "upload") {
    return `${label}${typeof pct === "number" ? `: ${pct}%` : "…"}`;
  }
  return label;
}

function isValidGeminiKey(key) {
  const trimmed = String(key || "").trim();
  return (
    /^AIza[0-9A-Za-z_-]{20,}$/.test(trimmed) ||
    /^AQ\.[A-Za-z0-9_-]{20,}$/.test(trimmed)
  );
}

async function resolveGeminiApiKey() {
  if (cachedApiKey) return cachedApiKey;

  const imported = String(GEMINI_API_KEY || "").trim();
  if (imported) {
    cachedApiKey = imported;
    return cachedApiKey;
  }

  try {
    const res = await fetch(`./js/config.js?cb=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/GEMINI_API_KEY\s*=\s*"([^"]*)"/);
      const fetched = match?.[1]?.trim() || "";
      if (fetched) {
        cachedApiKey = fetched;
        return cachedApiKey;
      }
    }
  } catch {
    // ignore — fall through to error below
  }

  return "";
}

function missingKeyMessage() {
  return [
    "مفتاح Gemini غير موجود في التطبيق.",
    "1) أنشئ مفتاحاً من Google AI Studio: https://aistudio.google.com/apikey",
    "2) أضفه في GitHub → Settings → Secrets → GEMINI_API_KEY",
    "3) أعد تشغيل workflow «Deploy GitHub Pages»",
    "4) حدّث الصفحة تحديثاً قوياً (Ctrl+Shift+R)",
  ].join(" ");
}

function invalidKeyMessage() {
  return [
    "مفتاح Gemini غير صالح.",
    "أنشئ مفتاحاً من Google AI Studio: https://aistudio.google.com/apikey",
    "المفاتيح الجديدة تبدأ بـ AQ. والقديمة بـ AIzaSy — كلاهما مقبول.",
    "ثم حدّث GEMINI_API_KEY في GitHub Secrets وأعد تشغيل «Deploy GitHub Pages».",
  ].join(" ");
}

async function prepareImageBlob(blob) {
  if (!globalThis.createImageBitmap || !globalThis.document) {
    return { blob, mimeType: blob.type || "image/jpeg" };
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
      return { blob, mimeType: blob.type || "image/jpeg" };
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const prepared = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (next) => (next ? resolve(next) : reject(new Error("تعذّر تصغير الصورة."))),
        "image/jpeg",
        0.92
      );
    });
    return { blob: prepared, mimeType: "image/jpeg" };
  } catch {
    return { blob, mimeType: blob.type || "image/jpeg" };
  }
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function formatGeminiError(status, payload, apiKey) {
  const message = payload?.error?.message || `Google AI (${status})`;
  if (status === 401 || status === 403) {
    if (!isValidGeminiKey(apiKey)) {
      return invalidKeyMessage();
    }
    if (/API key/i.test(message)) {
      return `رفض Google AI المفتاح: ${message}`;
    }
  }
  if (status === 429) {
    return "تم تجاوز حد استخدام Google AI. حاول بعد قليل.";
  }
  return message;
}

async function callGeminiVision(apiKey, base64, mimeType, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: OCR_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(formatGeminiError(res.status, payload, apiKey));
    error.status = res.status;
    throw error;
  }

  return extractGeminiText(payload);
}

async function extractWithGemini(base64, mimeType, onProgress) {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error(missingKeyMessage());
  }
  if (!isValidGeminiKey(apiKey)) {
    throw new Error(invalidKeyMessage());
  }

  onProgress?.({ stage: "upload", pct: 20 });

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      onProgress?.({ stage: "ocr", pct: 40 });
      const text = await withTimeout(
        callGeminiVision(apiKey, base64, mimeType, model),
        OCR_TIMEOUT_MS,
        "استغرق استخراج النص وقتاً طويلاً. جرّب صورة أصغر أو أوضح."
      );
      onProgress?.({ stage: "ocr", pct: 100 });
      return text;
    } catch (error) {
      lastError = error;
      if (error.status === 404) continue;
      throw error;
    }
  }

  throw lastError || new Error("تعذّر استخراج النص من الصورة.");
}

export async function extractImageText(file, onProgress) {
  const source = file instanceof Blob ? file : new Blob([file]);
  onProgress?.({ stage: "prepare", pct: 0 });

  const { blob, mimeType } = await prepareImageBlob(source);
  const base64 = await blobToBase64(blob);
  const text = normalizeOcrText(await extractWithGemini(base64, mimeType, onProgress));

  if (!text || text.length < 2) {
    throw new Error("لم يُعثر على نص في الصورة. جرّب صورة أوضح، إضاءة أفضل، أو نص أكبر.");
  }

  return text;
}
