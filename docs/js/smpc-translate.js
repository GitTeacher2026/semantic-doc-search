/**
 * Open-source SmPC translation:
 * 1) MyMemory Translation API (free, CORS-friendly)
 * 2) Optional self-hosted LibreTranslate (URL + API key in config)
 *
 * MyMemory: https://mymemory.translated.net/doc/spec.php
 * LibreTranslate: https://github.com/LibreTranslate/LibreTranslate
 */

import { LIBRETRANSLATE_API_KEY, LIBRETRANSLATE_URL } from "./config.js";

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MYMEMORY_CHUNK = 450;
const LIBRE_CHUNK = 1200;
const REQUEST_GAP_MS = 350;

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

async function translateWithMyMemory(text) {
  const url =
    `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent("en|ar")}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MyMemory (${response.status})`);
  const data = await response.json();
  if (Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || "فشلت ترجمة MyMemory.");
  }
  const translated = String(data.responseData?.translatedText || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
  if (!translated) throw new Error("MyMemory أعاد ترجمة فارغة.");
  if (/QUERY LENGTH LIMIT EXCEEDED/i.test(translated)) {
    throw new Error("تجاوز حد طول النص في MyMemory.");
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
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `LibreTranslate (${response.status})`);
  }
  const data = await response.json();
  const translated = String(data.translatedText || "").trim();
  if (!translated) throw new Error("LibreTranslate أعاد ترجمة فارغة.");
  return translated;
}

async function translateChunk(text, { preferLibre = false } = {}) {
  const errors = [];
  const order = preferLibre
    ? [translateWithLibreTranslate, translateWithMyMemory]
    : [translateWithMyMemory, translateWithLibreTranslate];

  for (const fn of order) {
    if (fn === translateWithLibreTranslate && !String(LIBRETRANSLATE_URL || "").trim()) {
      continue;
    }
    try {
      return await fn(text);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "تعذّرت الترجمة.");
}

async function translateLongText(text, { onStatus, label = "النص", preferLibre = false } = {}) {
  const prefer = preferLibre && Boolean(String(LIBRETRANSLATE_URL || "").trim());
  const size = prefer ? LIBRE_CHUNK : MYMEMORY_CHUNK;
  const chunks = chunkText(text, size);
  if (!chunks.length) return "";

  const out = [];
  for (let i = 0; i < chunks.length; i += 1) {
    onStatus?.(
      chunks.length > 1
        ? `ترجمة ${label} عبر محرك مفتوح المصدر… (${i + 1}/${chunks.length})`
        : `ترجمة ${label} عبر محرك مفتوح المصدر…`
    );
    out.push(await translateChunk(chunks[i], { preferLibre: prefer }));
    if (i < chunks.length - 1) await sleep(REQUEST_GAP_MS);
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
  "4.5 Interaction with other medicinal products": "4.5 التداخلات مع أدوية أخرى",
  "4.6 Fertility, pregnancy and lactation": "4.6 الخصوبة والحمل والرضاعة",
  "4.7 Effects on ability to drive and use machines": "4.7 تأثيرات القيادة وتشغيل الآلات",
  "4.8 Undesirable effects": "4.8 التأثيرات غير المرغوبة",
  "4.9 Overdose": "4.9 فرط الجرعة",
  "5. Pharmacological properties": "5. الخصائص الدوائية",
  "6. Pharmaceutical particulars": "6. الخصائص الصيدلانية",
  "DailyMed listing": "قائمة DailyMed",
};

async function translateHeading(title, { onStatus, preferLibre = false } = {}) {
  const known = HEADING_GLOSSARY[title];
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
    return "LibreTranslate (ذاتي) + MyMemory";
  }
  return "MyMemory Translation API (مفتوح)";
}

export async function translateSmpcSections(sections, { onStatus } = {}) {
  const preferLibre = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  onStatus?.(`محرك الترجمة: ${getTranslationEngineLabel()}`);
  const translated = [];

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    onStatus?.(`ترجمة القسم ${i + 1} من ${sections.length}: ${section.title}`);
    const arabicTitle = await translateHeading(section.title, { onStatus, preferLibre });
    const arabicText = await translateLongText(section.text, {
      onStatus,
      label: `القسم ${i + 1}`,
      preferLibre,
    });
    translated.push({
      key: section.key,
      title: arabicTitle,
      text: arabicText,
    });
    if (i < sections.length - 1) await sleep(REQUEST_GAP_MS);
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
