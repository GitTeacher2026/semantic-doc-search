const OCR_OPTIONS_KEY = "docshelf_ocr_options_v5";

export const OCR_ENGINES = {
  AUTO: "auto",
  PUTER: "puter",
};

export const DEFAULT_OCR_OPTIONS = {
  engine: OCR_ENGINES.AUTO,
};

export function getAvailableOcrEngines() {
  return [
    {
      id: OCR_ENGINES.AUTO,
      label: "تلقائي — Puter AI",
      hint: "استخراج سريع للنص عبر Puter.js — بدون مفتاح API",
      available: true,
    },
    {
      id: OCR_ENGINES.PUTER,
      label: "سريع — Puter AI",
      hint: "AWS/Mistral OCR عبر Puter.js",
      available: true,
    },
  ];
}

export function loadOcrOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OCR_OPTIONS_KEY) || "{}");
    const merged = { ...DEFAULT_OCR_OPTIONS, ...saved };
    const available = new Set(getAvailableOcrEngines().map((item) => item.id));
    if (!available.has(merged.engine)) {
      merged.engine = OCR_ENGINES.AUTO;
    }
    return merged;
  } catch {
    return { ...DEFAULT_OCR_OPTIONS };
  }
}

export function saveOcrOptions(options) {
  localStorage.setItem(
    OCR_OPTIONS_KEY,
    JSON.stringify({
      ...DEFAULT_OCR_OPTIONS,
      ...options,
      userSelected: true,
    })
  );
}

export function readOcrEngineFromForm(root = document) {
  const value = root.querySelector("#ocr-engine")?.value;
  const allowed = new Set(Object.values(OCR_ENGINES));
  return allowed.has(value) ? value : OCR_ENGINES.AUTO;
}

export function getOcrEngineLabel(engine) {
  const match = getAvailableOcrEngines().find((item) => item.id === engine);
  return match?.label || engine;
}

export function buildOcrEngineChain(preferred = loadOcrOptions().engine) {
  return [OCR_ENGINES.PUTER];
}
