import { getOcrSpaceKeySync, hydrateOcrSpaceKey, isOcrSpaceConfigured } from "./ocr-config.js";

const OCR_OPTIONS_KEY = "docshelf_ocr_options_v2";

export const OCR_ENGINES = {
  AUTO: "auto",
  TESSERACT: "tesseract",
  OCR_SPACE: "ocrspace",
};

export const DEFAULT_OCR_OPTIONS = {
  engine: OCR_ENGINES.OCR_SPACE,
};

export { hydrateOcrSpaceKey, isOcrSpaceConfigured };

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
    engines.unshift({
      id: OCR_ENGINES.OCR_SPACE,
      label: "سحابي — OCR.space",
      hint: "أسرع — يتحول تلقائياً إلى Tesseract إذا كانت الخدمة مشغولة",
      available: true,
    });
    engines.unshift({
      id: OCR_ENGINES.AUTO,
      label: "تلقائي (سحابي ثم محلي)",
      hint: "يجرب OCR.space أولاً ثم Tesseract عند الفشل",
      available: true,
    });
  } else {
    engines.unshift({
      id: OCR_ENGINES.AUTO,
      label: "تلقائي (محلي)",
      hint: "يستخدم Tesseract المحلي — أضف OCR_SPACE_API_KEY لتفعيل السحابي",
      available: true,
    });
  }

  return engines;
}

export function loadOcrOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OCR_OPTIONS_KEY) || "{}");
    const merged = { ...DEFAULT_OCR_OPTIONS, ...saved };
    if (!isOcrSpaceConfigured()) {
      merged.engine = OCR_ENGINES.TESSERACT;
    } else if (
      saved.engine === OCR_ENGINES.TESSERACT &&
      !saved.userSelected
    ) {
      merged.engine = OCR_ENGINES.OCR_SPACE;
    }
    return merged;
  } catch {
    return {
      ...DEFAULT_OCR_OPTIONS,
      engine: isOcrSpaceConfigured() ? OCR_ENGINES.OCR_SPACE : OCR_ENGINES.TESSERACT,
    };
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
  if (value === OCR_ENGINES.TESSERACT || value === OCR_ENGINES.OCR_SPACE) {
    return value;
  }
  return OCR_ENGINES.AUTO;
}

export function getOcrEngineLabel(engine) {
  const match = getAvailableOcrEngines().find((item) => item.id === engine);
  return match?.label || engine;
}

export function resolveOcrEngine(preferred = loadOcrOptions().engine) {
  if (preferred === OCR_ENGINES.TESSERACT) return OCR_ENGINES.TESSERACT;
  if (isOcrSpaceConfigured()) {
    if (preferred === OCR_ENGINES.OCR_SPACE || preferred === OCR_ENGINES.AUTO) {
      return OCR_ENGINES.OCR_SPACE;
    }
  }
  return OCR_ENGINES.TESSERACT;
}

export function getOcrFallbackEngine(engine, allowFallback = true) {
  if (!allowFallback) return null;
  if (engine === OCR_ENGINES.OCR_SPACE) return OCR_ENGINES.TESSERACT;
  return null;
}
