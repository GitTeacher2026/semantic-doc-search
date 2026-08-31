const OCR_OPTIONS_KEY = "docshelf_ocr_options_v4";

export const OCR_ENGINES = {
  AUTO: "auto",
  PUTER: "puter",
  PADDLE: "paddle",
  TESSERACT: "tesseract",
};

export const DEFAULT_OCR_OPTIONS = {
  engine: OCR_ENGINES.AUTO,
};

export function getAvailableOcrEngines() {
  return [
    {
      id: OCR_ENGINES.AUTO,
      label: "تلقائي (سريع ثم محلي)",
      hint: "يجرب Puter ثم PaddleOCR ثم Tesseract عند الحاجة",
      available: true,
    },
    {
      id: OCR_ENGINES.PUTER,
      label: "سريع — Puter AI",
      hint: "بدون مفتاح API — AWS/Mistral OCR عبر Puter.js",
      available: true,
    },
    {
      id: OCR_ENGINES.PADDLE,
      label: "محلي — PaddleOCR",
      hint: "يعمل في المتصفح — دقة عالية للعربية (~12 م.ب في التحميل الأول)",
      available: true,
    },
    {
      id: OCR_ENGINES.TESSERACT,
      label: "محلي — Tesseract",
      hint: "مجاني بالكامل — أبطأ في المرة الأولى",
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
  const chain = [];
  const add = (id) => {
    if (!id) return;
    if (!chain.includes(id)) chain.push(id);
  };

  if (preferred === OCR_ENGINES.TESSERACT) return [OCR_ENGINES.TESSERACT];
  if (preferred === OCR_ENGINES.PADDLE) {
    add(OCR_ENGINES.PADDLE);
    add(OCR_ENGINES.TESSERACT);
    return chain;
  }
  if (preferred === OCR_ENGINES.PUTER) {
    add(OCR_ENGINES.PUTER);
    add(OCR_ENGINES.PADDLE);
    add(OCR_ENGINES.TESSERACT);
    return chain;
  }

  add(OCR_ENGINES.PUTER);
  add(OCR_ENGINES.PADDLE);
  add(OCR_ENGINES.TESSERACT);
  return chain;
}
