/**
 * SmPC EN→AR translation (browser, no API key required by default):
 * 1) Google Translate public endpoints (fast, large chunks)
 * 2) Lingva public mirrors (Google proxy — usually fast)
 * 3) MyMemory last resort only (slow / small chunks)
 * 4) Optional self-hosted LibreTranslate when configured
 */

import { LIBRETRANSLATE_API_KEY, LIBRETRANSLATE_URL } from "./config.js";

const GOOGLE_ENDPOINTS = [
  // gtx single — often CORS-open
  (q) =>
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=${encodeURIComponent(q)}`,
  // clients5 dict-chrome
  (q) =>
    `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ar&q=${encodeURIComponent(q)}`,
];

const LINGVA_HOSTS = [
  "lingva.ml",
  "lingva.thedaviddelta.com",
  "translate.plausibility.cloud",
  "lingva.lunar.icu",
  "lingva.garudalinux.org",
];

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

const GOOGLE_CHUNK = 1600;
const LINGVA_CHUNK = 1200;
const MYMEMORY_CHUNK = 350;
const LIBRE_CHUNK = 1400;
const SECTION_CONCURRENCY = 3;
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTranslated(text) {
  return String(text || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
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

function extractGoogleTranslation(data) {
  if (typeof data === "string") return cleanTranslated(data);
  if (Array.isArray(data)) {
    // gtx: [[["ar","en",...],...],...]
    if (Array.isArray(data[0])) {
      if (Array.isArray(data[0][0])) {
        return cleanTranslated(
          data[0]
            .map((row) => (Array.isArray(row) ? row[0] : ""))
            .filter(Boolean)
            .join("")
        );
      }
      // dict-chrome: [["ar","en"], ...] or ["ar","en"]
      if (typeof data[0][0] === "string") {
        return cleanTranslated(data.map((row) => (Array.isArray(row) ? row[0] : row)).join(""));
      }
    }
    if (typeof data[0] === "string") return cleanTranslated(data.join(""));
  }
  if (data && typeof data === "object" && data.translation) {
    return cleanTranslated(data.translation);
  }
  return "";
}

async function translateWithGoogle(text) {
  const errors = [];
  for (const buildUrl of GOOGLE_ENDPOINTS) {
    try {
      const response = await fetch(buildUrl(text));
      if (response.status === 429) throw new Error("Google Translate (429)");
      if (!response.ok) throw new Error(`Google Translate (${response.status})`);
      const raw = await response.text();
      if (/^\s*</.test(raw) || /sorry|automated queries|captcha/i.test(raw.slice(0, 400))) {
        throw new Error("Google Translate blocked");
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error("Google Translate non-JSON");
      }
      const translated = extractGoogleTranslation(data);
      if (!translated) throw new Error("Google Translate أعاد ترجمة فارغة.");
      return translated;
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "Google Translate failed");
}

async function translateWithLingva(text) {
  const errors = [];
  for (const host of LINGVA_HOSTS) {
    try {
      const url = `https://${host}/api/v1/en/ar/${encodeURIComponent(text)}`;
      const response = await fetch(url);
      if (response.status === 429) throw new Error(`Lingva/${host} (429)`);
      if (!response.ok) throw new Error(`Lingva/${host} (${response.status})`);
      const data = await response.json();
      const translated = cleanTranslated(data.translation || data.text || "");
      if (!translated) throw new Error(`Lingva/${host} أعاد ترجمة فارغة.`);
      return translated;
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "Lingva failed");
}

async function translateWithMyMemory(text) {
  // Keep queries short — MyMemory free tier rejects long chunks and throttles hard.
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


async function translateWithPuter(text) {
  try {
    const { ensurePuterConnected, isPuterConnected, isPuterPreconfigured } = await import("./puter-auth.js");
    if (!isPuterConnected() && !isPuterPreconfigured()) {
      throw new Error("Puter AI غير متصل.");
    }
    const puter = await ensurePuterConnected();
    if (!puter?.ai?.chat) throw new Error("puter.ai.chat غير متاح.");
    const prompt =
      "Translate the following pharmaceutical SmPC English text to Modern Standard Arabic. " +
      "Keep drug names, doses, units, section numbers, and table structure. " +
      "Return Arabic translation only, with no preface.\n\n" +
      text;
    const result = await puter.ai.chat(prompt, { model: "gpt-5o-mini" }).catch(async () =>
      puter.ai.chat(prompt)
    );
    const translated = cleanTranslated(
      typeof result === "string"
        ? result
        : result?.message?.content || result?.toString?.() || ""
    );
    if (!translated) throw new Error("Puter AI أعاد ترجمة فارغة.");
    return translated;
  } catch (error) {
    throw new Error(error?.message || "Puter AI translation failed");
  }
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

async function withRetries(fn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error);
      const rateLimited = /\(429\)|quota|حصة/i.test(msg);
      if (!rateLimited && attempt >= 1) break;
      await sleep(rateLimited ? 900 * (attempt + 1) ** 2 : 250 * (attempt + 1));
    }
  }
  throw lastError || new Error("translator failed");
}

async function translateChunkFast(text) {
  const errors = [];
  const libreConfigured = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  // Prefer fast public engines, then Puter AI (already configured for OCR), MyMemory last.
  const order = libreConfigured
    ? [
        translateWithLibreTranslate,
        translateWithGoogle,
        translateWithLingva,
        translateWithPuter,
        translateWithMyMemory,
      ]
    : [
        translateWithGoogle,
        translateWithLingva,
        translateWithPuter,
        translateWithMyMemory,
      ];

  for (const fn of order) {
    try {
      // MyMemory needs tiny chunks — if we reached it with a large piece, split further.
      if (fn === translateWithMyMemory && text.length > MYMEMORY_CHUNK) {
        const bits = chunkText(text, MYMEMORY_CHUNK);
        const out = [];
        for (let i = 0; i < bits.length; i += 1) {
          out.push(await withRetries(() => translateWithMyMemory(bits[i])));
          if (i < bits.length - 1) await sleep(350);
        }
        return out.join("\n\n").trim();
      }
      return await withRetries(() => fn(text));
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "تعذّرت الترجمة.");
}

async function translateLongText(text, { onStatus, label = "النص" } = {}) {
  const libreConfigured = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  const size = libreConfigured ? LIBRE_CHUNK : GOOGLE_CHUNK;
  const chunks = chunkText(text, size);
  if (!chunks.length) return "";

  const out = [];
  for (let i = 0; i < chunks.length; i += 1) {
    onStatus?.(
      chunks.length > 1
        ? `ترجمة ${label}… (${i + 1}/${chunks.length})`
        : `ترجمة ${label}…`
    );
    out.push(await translateChunkFast(chunks[i]));
    if (i < chunks.length - 1) await sleep(80);
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
  CONTRAINDICATIONS: "موانع الاستعمال",
  "WARNINGS AND PRECAUTIONS": "تحذيرات واحتياطات",
  "ADVERSE REACTIONS": "التأثيرات الضائرة",
  "DRUG INTERACTIONS": "التداخلات الدوائية",
  "USE IN SPECIFIC POPULATIONS": "الاستعمال في فئات سكانية محددة",
  OVERDOSAGE: "فرط الجرعة",
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
  const bare = normalized.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
  for (const [en, ar] of Object.entries(HEADING_GLOSSARY)) {
    if (en.toLowerCase() === bare.toLowerCase()) {
      const num = normalized.match(/^(\d+(?:\.\d+)*)\s+/);
      return num ? `${num[1]} ${ar.replace(/^\d+(?:\.\d+)*\s+/, "")}` : ar;
    }
  }
  return "";
}

async function translateHeading(title, { onStatus } = {}) {
  const known = glossaryLookup(title);
  if (known) return known;
  try {
    return await translateLongText(title, { onStatus, label: "عنوان القسم" });
  } catch {
    return title;
  }
}

export function getTranslationEngineLabel() {
  if (String(LIBRETRANSLATE_URL || "").trim()) {
    return "LibreTranslate + Google + Lingva + Puter";
  }
  return "Google Translate + Lingva + Puter AI";
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export async function translateSmpcSections(sections, { onStatus } = {}) {
  onStatus?.(`محرك الترجمة: ${getTranslationEngineLabel()} (MyMemory احتياطي فقط)`);
  const total = sections.length;
  let completed = 0;
  let skippedEmpty = 0;

  const translated = await mapPool(sections, SECTION_CONCURRENCY, async (section, i) => {
    const body = String(section.text || "").trim();
    const arabicTitle = await translateHeading(section.title, { onStatus });

    if (!body || /^\(see subsections below\.?\)$/i.test(body) || body.length < 8) {
      skippedEmpty += 1;
      completed += 1;
      onStatus?.(`ترجمة القسم ${completed} من ${total}…`);
      return {
        key: section.key,
        title: arabicTitle,
        text: body
          ? await translateLongText(body, { label: `القسم ${i + 1}` }).catch(() => body)
          : "",
      };
    }

    const arabicText = await translateLongText(body, {
      onStatus,
      label: `القسم ${i + 1}/${total}`,
    });
    completed += 1;
    onStatus?.(`ترجمة القسم ${completed} من ${total}…`);
    return {
      key: section.key,
      title: arabicTitle,
      text: arabicText,
    };
  });

  if (skippedEmpty) {
    onStatus?.(`اكتملت الترجمة (تُخطّي ${skippedEmpty} قسماً فارغاً/عناوين فقط).`);
  } else {
    onStatus?.("اكتملت الترجمة.");
  }
  return translated;
}

export async function translatePlainText(text, { onStatus } = {}) {
  return translateLongText(text, { onStatus, label: "النص" });
}
