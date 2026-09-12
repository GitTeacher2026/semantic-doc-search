/**
 * SmPC EN→AR translation priority (MyMemory is last resort only):
 * 1) Google clients5 direct (CORS *) — historically the reliable browser path
 * 2) Google via Puter.net.fetch
 * 3) Google via short-timeout CORS proxies (raced)
 * 4) Lingva mirrors (raced, short timeout)
 * 5) Puter AI chat
 * 6) Optional LibreTranslate
 * 7) MyMemory
 */

import { LIBRETRANSLATE_API_KEY, LIBRETRANSLATE_URL } from "./config.js";

const GOOGLE_GTX =
  "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=";
const GOOGLE_CLIENTS5 =
  "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ar&q=";

const LINGVA_HOSTS = [
  "lingva.ml",
  "lingva.thedaviddelta.com",
  "lingva.lunar.icu",
  "lingva.garudalinux.org",
  "translate.plausibility.cloud",
];

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

const GOOGLE_CHUNK = 1500;
const PUTER_AI_CHUNK = 2200;
const MYMEMORY_CHUNK = 320;
const LIBRE_CHUNK = 1400;
const SECTION_CONCURRENCY = 2;
const MAX_RETRIES = 2;

let lastEngineUsed = "";
let stickyEngine = null; // reuse the first engine that works this session

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTranslated(text) {
  return String(text || "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/^(here is the translation[:\s]*|translation[:\s]*|العربية[:\s]*)/i, "")
    .trim();
}

export function getLastTranslationEngine() {
  return lastEngineUsed || "";
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
      if (breakAt > size * 0.35) end = start + breakAt + 1;
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
    if (Array.isArray(data[0])) {
      if (Array.isArray(data[0][0])) {
        return cleanTranslated(
          data[0]
            .map((row) => (Array.isArray(row) ? row[0] : ""))
            .filter(Boolean)
            .join("")
        );
      }
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

async function parseGoogleResponse(response, label) {
  if (response.status === 429) throw new Error(`${label} (429)`);
  if (!response.ok) throw new Error(`${label} (${response.status})`);
  const raw = await response.text();
  if (/^\s*</.test(raw) || /sorry|automated queries|captcha/i.test(raw.slice(0, 500))) {
    throw new Error(`${label} blocked`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${label} non-JSON`);
  }
  const translated = extractGoogleTranslation(data);
  if (!translated) throw new Error(`${label} أعاد ترجمة فارغة.`);
  return translated;
}

async function getPuterIfReady() {
  try {
    const { loadPuter, ensurePuterConnected, isPuterConnected, isPuterPreconfigured } = await import(
      "./puter-auth.js"
    );
    // net.fetch often works without a signed-in session — prefer loading Puter first.
    try {
      const puter = await loadPuter();
      if (puter?.net?.fetch || puter?.ai?.chat) {
        if (isPuterConnected() || isPuterPreconfigured()) {
          return await ensurePuterConnected().catch(() => puter);
        }
        return puter;
      }
    } catch {
      /* fall through */
    }
    if (!isPuterConnected() && !isPuterPreconfigured()) return null;
    return await ensurePuterConnected();
  } catch {
    return null;
  }
}

async function fetchWithBudget(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return response;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithGoogleViaPuter(text) {
  const puter = await getPuterIfReady();
  if (!puter?.net?.fetch) throw new Error("Puter net غير متاح.");

  // clients5 first — CORS-friendly and less 429-prone than gtx.
  const urls = [
    `${GOOGLE_CLIENTS5}${encodeURIComponent(text)}`,
    `${GOOGLE_GTX}${encodeURIComponent(text)}`,
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const response = await puter.net.fetch(url);
      const translated = await parseGoogleResponse(response, "Google/Puter");
      lastEngineUsed = "Google (via Puter)";
      stickyEngine = "puter-google";
      return translated;
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "Google/Puter failed");
}

/** Browser-safe Google Translate via public CORS proxies (short timeouts, raced). */
async function translateWithGoogleProxied(text) {
  const targets = [
    `${GOOGLE_CLIENTS5}${encodeURIComponent(text)}`,
    `${GOOGLE_GTX}${encodeURIComponent(text)}`,
  ];
  const proxies = [];
  for (const target of targets) {
    proxies.push(
      `https://corsproxy.io/?${encodeURIComponent(target)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
    );
  }
  const errors = [];
  try {
    const translated = await Promise.any(
      proxies.map(async (proxied) => {
        const response = await fetchWithBudget(proxied, 7000);
        return parseGoogleResponse(response, "Google/proxy");
      })
    );
    lastEngineUsed = "Google Translate";
    stickyEngine = "google-proxy";
    return translated;
  } catch (error) {
    const details =
      error?.errors?.map((e) => e?.message || e).join(" · ") || error?.message || "proxy failed";
    throw new Error(details);
  }
}

async function translateWithGoogleDirect(text) {
  // clients5 exposes Access-Control-Allow-Origin: * and is the reliable browser path.
  const urls = [
    `${GOOGLE_CLIENTS5}${encodeURIComponent(text)}`,
    `${GOOGLE_GTX}${encodeURIComponent(text)}`,
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetchWithBudget(url, 8000);
      const translated = await parseGoogleResponse(response, "Google");
      lastEngineUsed = "Google Translate";
      stickyEngine = "google-direct";
      return translated;
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(errors.filter(Boolean).join(" · ") || "Google Translate failed");
}

async function translateWithLingva(text) {
  const errors = [];
  try {
    const translated = await Promise.any(
      LINGVA_HOSTS.map(async (host) => {
        const response = await fetchWithBudget(
          `https://${host}/api/v1/en/ar/${encodeURIComponent(text)}`,
          7000
        );
        if (response.status === 429) throw new Error(`Lingva/${host} (429)`);
        if (!response.ok) throw new Error(`Lingva/${host} (${response.status})`);
        const data = await response.json();
        const out = cleanTranslated(data.translation || data.text || "");
        if (!out) throw new Error(`Lingva/${host} فارغ`);
        lastEngineUsed = `Lingva (${host})`;
        stickyEngine = "lingva";
        return out;
      })
    );
    return translated;
  } catch (error) {
    const details =
      error?.errors?.map((e) => e?.message || e).join(" · ") || error?.message || "Lingva failed";
    throw new Error(details);
  }
}

async function translateWithPuterAi(text) {
  const puter = await getPuterIfReady();
  if (!puter?.ai?.chat) throw new Error("Puter AI غير متاح.");
  const prompt =
    "Translate this pharmaceutical SmPC English text to Modern Standard Arabic. " +
    "Preserve drug names, doses, units, section numbers, and table layout. " +
    "Return Arabic only, no preface.\n\n" +
    text;
  const result = await puter.ai
    .chat(prompt)
    .catch(async () => puter.ai.chat(prompt, { model: "gpt-4o-mini" }));
  const translated = cleanTranslated(
    typeof result === "string"
      ? result
      : result?.message?.content || result?.toString?.() || ""
  );
  if (!translated) throw new Error("Puter AI أعاد ترجمة فارغة.");
  lastEngineUsed = "Puter AI";
  stickyEngine = "puter-ai";
  return translated;
}

async function translateWithLibreTranslatePost(text) {
  const base = String(LIBRETRANSLATE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("LibreTranslate غير مضبوط.");
  const payload = { q: text, source: "en", target: "ar", format: "text" };
  const key = String(LIBRETRANSLATE_API_KEY || "").trim();
  if (key) payload.api_key = key;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const response = await fetch(`${base}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (response.status === 429) throw new Error("LibreTranslate (429)");
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `LibreTranslate (${response.status})`);
    }
    const data = await response.json();
    const translated = cleanTranslated(data.translatedText);
    if (!translated) throw new Error("LibreTranslate أعاد ترجمة فارغة.");
    lastEngineUsed = "LibreTranslate";
    stickyEngine = "libre";
    return translated;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithMyMemory(text) {
  const url =
    `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}` +
    `&langpair=${encodeURIComponent("en|ar")}`;
  const response = await fetchWithBudget(url, 10000);
  if (response.status === 429) throw new Error("MyMemory (429)");
  if (!response.ok) throw new Error(`MyMemory (${response.status})`);
  const data = await response.json();
  if (Number(data.responseStatus) === 429) throw new Error("MyMemory (429)");
  if (Number(data.responseStatus) !== 200) {
    throw new Error(data.responseDetails || "فشلت ترجمة MyMemory.");
  }
  const translated = cleanTranslated(data.responseData?.translatedText);
  if (!translated) throw new Error("MyMemory أعاد ترجمة فارغة.");
  if (/QUERY LENGTH LIMIT EXCEEDED|MYMEMORY WARNING/i.test(translated)) {
    throw new Error("MyMemory: حد الطول/الحصة.");
  }
  lastEngineUsed = "MyMemory";
  stickyEngine = "mymemory";
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
      await sleep(rateLimited ? 800 * (attempt + 1) ** 2 : 200 * (attempt + 1));
    }
  }
  throw lastError || new Error("translator failed");
}

function engineOrder(libreConfigured) {
  const bySticky = {
    "google-direct": translateWithGoogleDirect,
    "puter-google": translateWithGoogleViaPuter,
    "google-proxy": translateWithGoogleProxied,
    lingva: translateWithLingva,
    "puter-ai": translateWithPuterAi,
    libre: translateWithLibreTranslatePost,
    mymemory: translateWithMyMemory,
  };
  const base = [
    translateWithGoogleDirect,
    translateWithGoogleViaPuter,
    translateWithGoogleProxied,
    translateWithLingva,
    translateWithPuterAi,
    ...(libreConfigured ? [translateWithLibreTranslatePost] : []),
    translateWithMyMemory,
  ];
  if (stickyEngine && bySticky[stickyEngine]) {
    const preferred = bySticky[stickyEngine];
    return [preferred, ...base.filter((fn) => fn !== preferred)];
  }
  return base;
}

async function translateChunkFast(text) {
  const errors = [];
  const libreConfigured = Boolean(String(LIBRETRANSLATE_URL || "").trim());
  // Google clients5 direct first so MyMemory is not the everyday engine.
  const order = engineOrder(libreConfigured);

  for (const fn of order) {
    try {
      if (fn === translateWithMyMemory && text.length > MYMEMORY_CHUNK) {
        const bits = chunkText(text, MYMEMORY_CHUNK);
        const out = [];
        for (let i = 0; i < bits.length; i += 1) {
          out.push(await withRetries(() => translateWithMyMemory(bits[i])));
          if (i < bits.length - 1) await sleep(300);
        }
        return out.join("\n\n").trim();
      }
      if (fn === translateWithPuterAi && text.length > PUTER_AI_CHUNK) {
        const bits = chunkText(text, PUTER_AI_CHUNK);
        const out = [];
        for (const bit of bits) out.push(await withRetries(() => translateWithPuterAi(bit)));
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
  const size = String(LIBRETRANSLATE_URL || "").trim() ? LIBRE_CHUNK : GOOGLE_CHUNK;
  const chunks = chunkText(text, size);
  if (!chunks.length) return "";
  const out = [];
  for (let i = 0; i < chunks.length; i += 1) {
    onStatus?.(
      chunks.length > 1 ? `ترجمة ${label}… (${i + 1}/${chunks.length})` : `ترجمة ${label}…`
    );
    out.push(await translateChunkFast(chunks[i]));
    if (i < chunks.length - 1) await sleep(60);
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
  "FULL PRESCRIBING INFORMATION": "معلومات الوصفة الكاملة",
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
  "HOW SUPPLIED/STORAGE AND HANDLING": "التوفير / التخزين والمناولة",
  "PATIENT COUNSELING INFORMATION": "معلومات إرشاد المريض",
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
  return "Google (clients5) → Puter → Lingva → Puter AI → MyMemory (احتياطي)";
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()));
  return results;
}

/** Translate visible text nodes inside HTML while keeping tags/attrs (tables + images). */
async function translateRichHtml(html, { onStatus, label } = {}) {
  const source = String(html || "").trim();
  if (!source) return "";
  const slots = [];
  const masked = source.replace(/>([^<]+)</g, (full, text) => {
    if (!/[A-Za-z\u0600-\u06FF]/.test(text) || !text.trim()) return full;
    const id = slots.length;
    slots.push(text);
    return `>⟦T${id}⟧<`;
  });
  if (!slots.length) return source;

  const joined = slots.map((s, i) => `[[${i}]]${s}`).join("\n\n");
  const translatedBlob = await translateLongText(joined, { onStatus, label: label || "جدول" });
  const map = new Map();
  for (const piece of translatedBlob.split(/\n\n+/)) {
    const m = piece.match(/^\[\[(\d+)\]\]([\s\S]*)$/);
    if (m) map.set(Number(m[1]), cleanTranslated(m[2]));
  }
  // Fallback: sequential if markers lost
  if (map.size < slots.length * 0.5) {
    for (let i = 0; i < slots.length; i += 1) {
      if (!map.has(i)) {
        map.set(i, await translateLongText(slots[i], { onStatus, label: `${label || "خلية"} ${i + 1}` }));
      }
    }
  }

  return masked.replace(/⟦T(\d+)⟧/g, (_, id) => map.get(Number(id)) || slots[Number(id)] || "");
}

export async function translateSmpcSections(sections, { onStatus } = {}) {
  lastEngineUsed = "";
  stickyEngine = null;
  onStatus?.(`محرك الترجمة: ${getTranslationEngineLabel()}`);
  await getPuterIfReady();

  const total = sections.length;
  let completed = 0;

  const translated = await mapPool(sections, SECTION_CONCURRENCY, async (section, i) => {
    const body = String(section.text || "").trim();
    const html = String(section.html || "").trim();
    const arabicTitle = await translateHeading(section.title, { onStatus });

    if ((!body || body.length < 8) && !html) {
      completed += 1;
      onStatus?.(
        `ترجمة القسم ${completed}/${total}…${lastEngineUsed ? ` [${lastEngineUsed}]` : ""}`
      );
      return {
        key: section.key,
        title: arabicTitle,
        text: "",
        html: "",
      };
    }

    let arabicText = body;
    if (body && body.length >= 8 && !/^\(see subsections below\.?\)$/i.test(body)) {
      arabicText = await translateLongText(body, {
        onStatus,
        label: `القسم ${i + 1}/${total}`,
      });
    }

    let arabicHtml = "";
    if (html) {
      try {
        arabicHtml = await translateRichHtml(html, {
          onStatus,
          label: `تنسيق القسم ${i + 1}`,
        });
      } catch {
        arabicHtml = html;
      }
    }

    completed += 1;
    onStatus?.(
      `ترجمة القسم ${completed}/${total}…${lastEngineUsed ? ` عبر ${lastEngineUsed}` : ""}`
    );
    return {
      key: section.key,
      title: arabicTitle,
      text: arabicText,
      html: arabicHtml,
    };
  });

  onStatus?.(
    lastEngineUsed
      ? `اكتملت الترجمة (المحرك: ${lastEngineUsed}).`
      : "اكتملت الترجمة."
  );
  return translated;
}

export async function translatePlainText(text, { onStatus } = {}) {
  return translateLongText(text, { onStatus, label: "النص" });
}
