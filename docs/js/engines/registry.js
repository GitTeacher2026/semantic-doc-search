export const DEFAULT_ENGINE_SETTINGS = {
  searchEngine: "bm25",
  classificationEngine: "keyword-overlap",
  chunkingEngine: "fixed",
};

export const SEARCH_ENGINES = {
  bm25: {
    id: "bm25",
    label: "BM25",
    description: "بحث كلماتي سريع — الافتراضي الموصى به.",
    needsModel: false,
  },
  "bm25-ar": {
    id: "bm25-ar",
    label: "BM25 عربي محسّن",
    description: "BM25 مع تطبيع الحروف العربية وإزالة التشكيل.",
    needsModel: false,
  },
  tfidf: {
    id: "tfidf",
    label: "TF-IDF",
    description: "ترجيح بالتكرار النسبي — جيد للمستندات القصيرة.",
    needsModel: false,
  },
  substring: {
    id: "substring",
    label: "مطابقة نصية",
    description: "يبحث عن العبارة حرفياً داخل النص.",
    needsModel: false,
  },
  semantic: {
    id: "semantic",
    label: "دلالي (Embeddings)",
    description: "يفهم المعنى والمرادفات — يحمّل نموذجاً عند أول استخدام.",
    needsModel: true,
  },
  hybrid: {
    id: "hybrid",
    label: "هجين BM25 + دلالي",
    description: "يجمع الدقة اللفظية مع الفهم الدلالي.",
    needsModel: true,
  },
  "hybrid-lite": {
    id: "hybrid-lite",
    label: "هجين BM25 + TF-IDF",
    description: "دمج محركين سريعين بدون تحميل نموذج.",
    needsModel: false,
  },
};

export const CLASSIFICATION_ENGINES = {
  "keyword-overlap": {
    id: "keyword-overlap",
    label: "تداخل كلمات + مواضيع",
    description: "يربط الملف بمجلد موجود أو يُنشئ موضوعاً رئيسياً — الافتراضي.",
  },
  "broad-topics": {
    id: "broad-topics",
    label: "مواضيع رئيسية فقط",
    description: "يصنّف في مجلدات واسعة (إدارة، مالية، قانون…).",
  },
  "dominant-term": {
    id: "dominant-term",
    label: "كلمة مفتاحية واحدة",
    description: "يختار أهم كلمة في المستند كمجلد.",
  },
  filename: {
    id: "filename",
    label: "من اسم الملف",
    description: "يستخدم اسم الملف (بدون الامتداد) كتصنيف.",
  },
  "first-line": {
    id: "first-line",
    label: "من السطر الأول",
    description: "يأخذ أول سطر غير فارغ كعنوان المجلد.",
  },
};

export const CHUNKING_ENGINES = {
  fixed: {
    id: "fixed",
    label: "مقاطع ثابتة (800 حرف)",
    description: "تقسيم متداخل — الافتراضي.",
  },
  paragraph: {
    id: "paragraph",
    label: "حسب الفقرات",
    description: "كل فقرة أو مجموعة فقرات = مقطع.",
  },
  sentence: {
    id: "sentence",
    label: "حسب الجمل",
    description: "تقسيم عند نهاية الجمل.",
  },
  large: {
    id: "large",
    label: "مقاطع كبيرة (2000 حرف)",
    description: "سياق أوسع لكل مقطع.",
  },
};

export function normalizeEngineSettings(settings) {
  const next = settings && typeof settings === "object" ? settings : {};
  return {
    searchEngine: SEARCH_ENGINES[next.searchEngine] ? next.searchEngine : DEFAULT_ENGINE_SETTINGS.searchEngine,
    classificationEngine: CLASSIFICATION_ENGINES[next.classificationEngine]
      ? next.classificationEngine
      : DEFAULT_ENGINE_SETTINGS.classificationEngine,
    chunkingEngine: CHUNKING_ENGINES[next.chunkingEngine]
      ? next.chunkingEngine
      : DEFAULT_ENGINE_SETTINGS.chunkingEngine,
  };
}
