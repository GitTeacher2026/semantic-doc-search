import { OCR_SPACE_API_KEY } from "./config.js";

const OCR_OPTIONS_KEY = "docshelf_ocr_options";

export const OCR_ENGINES = {
  AUTO: "auto",
  TESSERACT: "tesseract",
  OCR_SPACE: "ocrspace",
};

export const DEFAULT_OCR_OPTIONS = {
  engine: OCR_ENGINES.AUTO,
};

export function isOcrSpaceConfigured() {
  return String(OCR_SPACE_API_KEY || "").trim().length >= 8;
}

export function getAvailableOcrEngines() {
  const engines = [
    {
      id: OCR_ENGINES.TESSERACT,
      label: "محلي — Tesseract",
      hint: "مجاني، يعمل بدون مفتاح، أبطأ في المرة الأولى",
      available: true,
    },
  ];

  if (isOcrSpaceConfigured()) {
    engines.push({
      id: OCR_ENGINES.OCR_SPACE,
      label: "سحابي — OCR.space",
      hint: "أسرع، يحتاج مفتاح API",
      available: true,
    });
  }

  engines.unshift({
    id: OCR_ENGINES.AUTO,
    label: isOcrSpaceConfigured() ? "تلقائي (سحابي ثم محلي)" : "تلقائي (محلي)",
    hint: isOcrSpaceConfigured()
      ? "يجرب OCR.space أولاً ثم Tesseract عند الفشل"
      : "يستخدم Tesseract المحلي",
    available: true,
  });

  return engines;
}

export function loadOcrOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OCR_OPTIONS_KEY) || "{}");
    return { ...DEFAULT_OCR_OPTIONS, ...saved };
  } catch {
    return { ...DEFAULT_OCR_OPTIONS };
  }
}

export function saveOcrOptions(options) {
  localStorage.setItem(
    OCR_OPTIONS_KEY,
    JSON.stringify({ ...DEFAULT_OCR_OPTIONS, ...options })
  );
}

export function readOcrEngineFromForm(root = document) {
  const value = root.querySelector("#ocr-engine")?.value;
  if (value === OCR_ENGINES.TESSERACT || value === OCR_ENGINES.OCR_SPACE) {
    return value;
  }
  return OCR_ENGINES.AUTO;
}

export function applyOcrOptionsToForm(options, root = document) {
  const select = root.querySelector("#ocr-engine");
  if (!select) return;

  const available = new Set(getAvailableOcrEngines().map((item) => item.id));
  for (const option of [...select.options]) {
    if (!available.has(option.value)) {
      option.disabled = true;
      option.hidden = true;
    }
  }

  if (available.has(options.engine)) {
    select.value = options.engine;
  } else {
    select.value = OCR_ENGINES.AUTO;
  }
}

export function getOcrEngineLabel(engine) {
  const match = getAvailableOcrEngines().find((item) => item.id === engine);
  return match?.label || engine;
}

export function resolveOcrEngine(preferred = loadOcrOptions().engine) {
  if (preferred === OCR_ENGINES.TESSERACT) return OCR_ENGINES.TESSERACT;
  if (preferred === OCR_ENGINES.OCR_SPACE && isOcrSpaceConfigured()) {
    return OCR_ENGINES.OCR_SPACE;
  }
  if (preferred === OCR_ENGINES.AUTO && isOcrSpaceConfigured()) {
    return OCR_ENGINES.OCR_SPACE;
  }
  return OCR_ENGINES.TESSERACT;
}

export function getOcrFallbackEngine(engine) {
  if (engine === OCR_ENGINES.OCR_SPACE) return OCR_ENGINES.TESSERACT;
  return null;
}
