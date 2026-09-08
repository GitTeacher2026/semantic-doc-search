/**
 * SmPC EN→AR translation:
 * 1) Google Translate public endpoint (clients5, CORS *) — fast, larger chunks
 * 2) MyMemory (open) with 429 backoff
 * 3) Optional self-hosted LibreTranslate
 */

import { LIBRETRANSLATE_API_KEY, LIBRETRANSLATE_URL } from "./config.js";

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const GOOGLE_ENDPOINT = "https://clients5.google.com/translate_a/t";

const GOOGLE_CHUNK = 1800;
const MYMEMORY_CHUNK = 400;
const LIBRE_CHUNK = 1400;
const GOOGLE_GAP_MS = 120;
const MYMEMORY_GAP_MS = 900;
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text, size) {
  const source = String(text || "").trim();
  if (!source) return [];
  if (source.length <= size) return [source];

  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      const window = source.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(".\n"),
        window.lastIndexOf(" ")
      );
      if (breakAt > size * 0.4) end = start + breakAt + 1;
    }
    const piece = source.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = end;
  }
  return parts;
}

function cleanTranslated(text) {
  return String(text || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
}

function extractGoogleTranslation(data) {
  if (typeof data === "string") return cleanTranslated(data);
  if (Array.isArray(data)) {
    if (typeof data[0] === "string") return cleanTranslated(data.join(""));
    // [["chunk","src"], ...] style
    if (Array.isArray(data[0])) {
      return cleanTranslated(
        data
          .map((row) => (Array.isArray(row) ? row[0] : row))
          .filter(Boolean)
          .join("")
      );
    }
  }
  if (data && typeof data === "object" && data.translation) {
    return cleanTranslated(data.translation);
  }
  return "";
}

async function translateWithGoogle(text) {
  const url =
    `${GOOGLE_ENDPOINT}?client=dict-chrome-ex` +
    `&sl=en&tl=ar&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (response.status === 429) throw new Error("Google Translate (429)");
  if (!response.ok) throw new Error(`Google Translate (${response.status})`);
  const data = await response.json();
  const translated = extractGoogleTranslation(data);
  if (!translated) throw new Error("Google Translate أعاد ترجمة فارغة.");
  return translated;
}

async function translateWithMyMemory(text) {
  const url =
    `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent("en|ar")}`;
  const response = await fetch(url);
  if (response.status === 429) throw new Error("MyMemory (429)");
  if (!response.ok) throw new Error(`MyMemory (${response.status})`);
  const data = await response.json();
  if (Number(data.responseStatus) === 429) throw new Error("MyMemory (429)");
  if (Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || "فشلت ترجمة MyMemory.");
  }
  const translated = cleanTranslated(data.responseData?.translatedText);
  if (!translated) throw new Error("MyMemory أعاد ترجمة فارغة.");
  if (/QUERY LENGTH LIMIT EXCEEDED/i.test(translated)) {
    throw new Error("تجاوز حد طول النص في MyMemory.");
  }
  if (/MYMEMORY WARNING/i.test(translated)) {
    throw new Error("MyMemory: تم تجاوز الحصة اليومية.");
  }
  return translated;
}

async function translateWithLibreTranslate(text) {
  const base = String(LIBRETRANSLATE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("LibreTranslate غير مضبوط.");

  const payload = {
    q: text,
    source: "en",
    target: "ar",
    format: "text",
  };
  const key = String(LIBRETRANSLATE_API_KEY || "").trim();
  if (key) payload.api_key = key;

  const response = await fetch(`${base}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 429) throw new Error("LibreTranslate (429)");
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `LibreTranslate (${response.status})`);
  }
  const data = await response.json();
  const translated = cleanTranslated(data.translatedText);
  if (!translated) throw new Error("LibreTranslate أعاد ترجمة فارغة.");
  return translated;
}

async function withRetries(fn, { label = "translator" } = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error);
      const rateLimited = /\(429\)|quota|حصة/i.test(msg);
      if (!rateLimited && attempt >= 1) break;
      const wait = rateLimited ? 1200 * (attempt + 1) ** 2 : 400 * (attempt + 1);
      await sleep(wait);
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function translateChunk(text, { preferLibre = false } = {}) {
  const errors = [];
  const order = preferLibre
    ? [translateWithLibreTranslate, translateWithGoogle, translateWithMyMemory]
    : [translateWithGoogle, translateWithMyMemory, translateWithLibreTranslate];

  for (const fn of order) {
    if (fn === translateWithLibreTranslate && !String(LIBRETRANSLATE_URL || "").trim()) {
      continue;
    }
    try {
      return await withRetries(() => fn(text));
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "تعذّرت الترجمة.");
}

function engineChunkSize(preferLibre) {
  if (preferLibre && String(LIBRETRANSLATE_URL || "").trim()) return LIBRE_CHUNK;
  return GOOGLE_CHUNK;
}

async function translateLongText(text, { onStatus, label = "النص", preferLibre = false } = {}) {
  const prefer = preferLibre && Boolean(String(LIBRETRANSLATE_URL || "").trim());
  const size = engineChunkSize(prefer);
  const chunks = chunkText(text, size);
  if (!chunks.length) return "";

  const out = [];
  for (let i = 0; i < chunks.length; i += 1) {
    onStatus?.(
      chunks.length > 1
        ? `ترجمة ${label}… (${i + 1}/${chunks.length})`
        : `ترجمة ${label}…`
    );
    out.push(await translateChunk(chunks[i], { preferLibre: prefer }));
    if (i < chunks.length - 1) {
      await sleep(prefer ? 200 : GOOGLE_GAP_MS);
    }
  }
  return out.join("\n\n").trim();
}

const HEADING_GLOSSARY = {
  "1. Name of the medicinal product": "1. اسم المستحضر الدوائي",
  "2. Qualitative and quantitative composition": "2. التركيب النوعي والكمي",
  "3. Pharmaceutical form": "3. الشكل الصيدلاني",
  "4. Clinical particulars": "4. الخصائص السريرية",
  "4.1 Therapeutic indications": "4.1 الاستطبابات العلاجية",
  "4.2 Posology and method of administration": "4.2 الجرعة وطريقة الإعطاء",
  "4.3 Contraindications": "4.3 موانع الاستعمال",
  "4.4 Special warnings and precautions": "4.4 تحذيرات واحتياطات خاصة",
  "4.4 Special warnings and precautions for use": "4.4 تحذيرات واحتياطات خاصة للاستعمال",
  "4.5 Interaction with other medicinal products": "4.5 التداخلات مع أدوية أخرى",
  "4.5 Interaction with other medicinal products and other forms of interaction":
    "4.5 التداخلات مع أدوية أخرى وأشكال أخرى من التداخل",
  "4.6 Fertility, pregnancy and lactation": "4.6 الخصوبة والحمل والرضاعة",
  "4.7 Effects on ability to drive and use machines": "4.7 تأثيرات القيادة وتشغيل الآلات",
  "4.8 Undesirable effects": "4.8 التأثيرات غير المرغوبة",
  "4.9 Overdose": "4.9 فرط الجرعة",
  "5. Pharmacological properties": "5. الخصائص الدوائية",
  "6. Pharmaceutical particulars": "6. الخصائص الصيدلانية",
  "HIGHLIGHTS OF PRESCRIBING INFORMATION": "أبرز معلومات الوصفة",
  "BOXED WARNING": "تحذير مؤطر",
  "INDICATIONS AND USAGE": "الاستطبابات والاستعمال",
  "DOSAGE AND ADMINISTRATION": "الجرعة وطريقة الإعطاء",
  "DOSAGE FORMS AND STRENGTHS": "أشكال الجرعات والتراكيز",
  "CONTRAINDICATIONS": "موانع الاستعمال",
  "WARNINGS AND PRECAUTIONS": "تحذيرات واحتياطات",
  "ADVERSE REACTIONS": "التأثيرات الضائرة",
  "DRUG INTERACTIONS": "التداخلات الدوائية",
  "USE IN SPECIFIC POPULATIONS": "الاستعمال في فئات سكانية محددة",
  "OVERDOSAGE": "فرط الجرعة",
  DESCRIPTION: "الوصف",
  "CLINICAL PHARMACOLOGY": "علم الأدوية السريري",
  "NONCLINICAL TOXICOLOGY": "السموميات غير السريرية",
  "CLINICAL STUDIES": "دراسات سريرية",
  "HOW SUPPLIED": "كيفية التوفير",
  "PATIENT COUNSELING INFORMATION": "معلومات إرشاد المريض",
  "DailyMed listing": "قائمة DailyMed",
};

function glossaryLookup(title) {
  if (HEADING_GLOSSARY[title]) return HEADING_GLOSSARY[title];
  const normalized = String(title || "").replace(/\s+/g, " ").trim();
  if (HEADING_GLOSSARY[normalized]) return HEADING_GLOSSARY[normalized];
  // Strip leading numbering variants: "1 INDICATIONS AND USAGE"
  const bare = normalized.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
  for (const [en, ar] of Object.entries(HEADING_GLOSSARY)) {
    if (en.toLowerCase() === bare.toLowerCase()) {
      const num = normalized.match(/^(\d+(?:\.\d+)*)\s+/);
      return num ? `${num[1]} ${ar.replace(/^\d+(?:\.\d+)*\s+/, "")}` : ar;
    }
  }
  return "";
}

async function translateHeading(title, { onStatus, preferLibre = false } = {}) {
  const known = glossaryLookup(title);
  if (known) return known;
  try {
    return await translateLongText(title, {
      onStatus,
      label: "عنوان القسم",
      preferLibre,
    });
  } catch {
    return title;
  }
}

export function getTranslationEngineLabel() {
  if (String(LIBRETRANSLATE_URL || "").trim()) {
    return "LibreTranslate + Google + MyMemory";
  }
  return "Google Translate + MyMemory";
}

export async function translateSmpcSections(sections, { onStatus } = {}) {
  const preferLibre = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  onStatus?.(`محرك الترجمة: ${getTranslationEngineLabel()}`);
  const translated = [];
  const total = sections.length;
  let skippedEmpty = 0;

  for (let i = 0; i < total; i += 1) {
    const section = sections[i];
    const body = String(section.text || "").trim();
    onStatus?.(`ترجمة القسم ${i + 1} من ${total}: ${section.title}`);

    const arabicTitle = await translateHeading(section.title, { onStatus, preferLibre });

    // Skip placeholder-only parent headings to save quota/time
    if (!body || /^\(see subsections below\.?\)$/i.test(body) || body.length < 8) {
      skippedEmpty += 1;
      translated.push({
        key: section.key,
        title: arabicTitle,
        text: body ? await translateLongText(body, { preferLibre }).catch(() => body) : "",
      });
      continue;
    }

    const arabicText = await translateLongText(body, {
      onStatus,
      label: `القسم ${i + 1}/${total}`,
      preferLibre,
    });
    translated.push({
      key: section.key,
      title: arabicTitle,
      text: arabicText,
    });

    // Gentle pacing between sections (MyMemory fallback path is slower internally)
    if (i < total - 1) await sleep(GOOGLE_GAP_MS);
  }

  if (skippedEmpty) {
    onStatus?.(`اكتملت الترجمة (تُخطّي ${skippedEmpty} قسماً فارغاً/عناوين فقط).`);
  }
  return translated;
}

export async function translatePlainText(text, { onStatus } = {}) {
  const preferLibre = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  return translateLongText(text, {
    onStatus,
    label: "النص",
    preferLibre,
  });
}
