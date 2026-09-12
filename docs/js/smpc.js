/**
 * SmPC search & full-document viewer for three sources:
 * - DailyMed (US SPL / prescribing info)
 * - MHRA Products (UK SpC PDFs via Azure Search + products.mhra.gov.uk)
 * - drugs.com (US package insert — content via FDA/DailyMed when site blocks bots)
 *
 * Sites without CORS are loaded through public readers/proxies with fallbacks.
 */

import {
  restoreSpcTablesInMarkdown,
  extractTablesFromPdfBytes,
  injectTablesIntoSections,
} from "./smpc-tables.js";
import { extractPdfTextLayer } from "./pdf-utils.js";

const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";
const OPENFDA_NDC = "https://api.fda.gov/drug/ndc.json";
const DAILYMED_SPLS = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";
const JINA_PREFIX = "https://r.jina.ai/";
const ALLORIGINS_RAW = "https://api.allorigins.win/raw?url=";
const PROXY_PREF_KEY = "smpc_proxy_pref_v5";
const MHRA_SEARCH_HOST = "https://mhraproducts4853.search.windows.net";
const MHRA_SEARCH_INDEX = "products-index";
/** Public query key embedded by products.mhra.gov.uk front-end (CORS *). */
const MHRA_SEARCH_API_KEY = "17CCFC430C1A78A169B392A35A99C49D";
const MHRA_SEARCH_API_VERSION = "2017-11-11";

/** Serialize Puter networking so the Wisp/WebSocket can finish connecting. */
let puterFetchQueue = Promise.resolve();

/** Reuse MHRA PDF bytes between text extract and table extract in one hydrate. */
const mhraPdfBytesCache = new Map();

function pdfBytesToArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export const SMPC_SOURCE_OPTIONS = [
  {
    id: "all",
    label: "الكل",
    hint: "بحث في DailyMed + MHRA + drugs.com",
  },
  {
    id: "dailymed",
    label: "DailyMed",
    hint: "نشرات FDA الأمريكية الكاملة (SPL)",
  },
  {
    id: "emc",
    label: "MHRA",
    hint: "SmPC بريطاني من products.mhra.gov.uk",
  },
  {
    id: "drugs",
    label: "drugs.com",
    hint: "Package Insert (عبر FDA عند الحجب)",
  },
];

/** Extra OpenFDA fields appended when XML/HTML hydration is unavailable. */
const OPENFDA_EXTRA_FIELDS = [
  { key: "boxed_warning", title: "Boxed warning", fields: ["boxed_warning"] },
  { key: "purpose", title: "Purpose", fields: ["purpose"] },
  { key: "keep_out", title: "Keep out of reach of children", fields: ["keep_out_of_reach_of_children"] },
  { key: "questions", title: "Questions", fields: ["questions"] },
  { key: "information_for_patients", title: "Information for patients", fields: ["information_for_patients"] },
  { key: "use_in_specific_populations", title: "Use in specific populations", fields: ["use_in_specific_populations", "use_in_specific_populations_table", "pediatric_use", "geriatric_use"] },
  { key: "nonclinical", title: "Nonclinical toxicology", fields: ["nonclinical_toxicology", "carcinogenesis_and_mutagenesis_and_impairment_of_fertility"] },
  { key: "clinical_studies", title: "Clinical studies", fields: ["clinical_studies", "clinical_studies_table"] },
  { key: "risks", title: "Risks", fields: ["risks"] },
  { key: "spl_patient", title: "Patient package insert", fields: ["spl_patient_package_insert", "spl_patient_package_insert_table"] },
];

const SECTION_MAP = [
  { key: "product_overview", title: "1. Name of the medicinal product", fields: [] },
  { key: "qualitative_quantitative", title: "2. Qualitative and quantitative composition", fields: ["active_ingredient", "inactive_ingredient", "spl_product_data_elements"] },
  { key: "pharmaceutical_form", title: "3. Pharmaceutical form", fields: ["dosage_forms_and_strengths", "dosage_forms_and_strengths_table", "description"] },
  { key: "indications", title: "4.1 Therapeutic indications", fields: ["indications_and_usage", "indications_and_usage_table", "purpose"] },
  { key: "posology", title: "4.2 Posology and method of administration", fields: ["dosage_and_administration", "dosage_and_administration_table"] },
  { key: "contraindications", title: "4.3 Contraindications", fields: ["contraindications", "do_not_use"] },
  { key: "warnings", title: "4.4 Special warnings and precautions", fields: ["warnings", "warnings_and_cautions", "warnings_and_cautions_table", "boxed_warning", "ask_doctor", "ask_doctor_or_pharmacist", "when_using", "stop_use", "precautions"] },
  { key: "interactions", title: "4.5 Interaction with other medicinal products", fields: ["drug_interactions", "drug_interactions_table"] },
  { key: "pregnancy", title: "4.6 Fertility, pregnancy and lactation", fields: ["pregnancy", "pregnancy_or_breast_feeding", "nursing_mothers", "labor_and_delivery"] },
  { key: "driving", title: "4.7 Effects on ability to drive and use machines", fields: [] },
  { key: "undesirable_effects", title: "4.8 Undesirable effects", fields: ["adverse_reactions", "adverse_reactions_table"] },
  { key: "overdose", title: "4.9 Overdose", fields: ["overdosage"] },
  { key: "pharmacodynamics", title: "5.1 Pharmacodynamic properties", fields: ["mechanism_of_action", "pharmacodynamics", "microbiology"] },
  { key: "pharmacokinetics", title: "5.2 Pharmacokinetic properties", fields: ["pharmacokinetics", "pharmacokinetics_table", "clinical_pharmacology", "clinical_pharmacology_table"] },
  { key: "preclinical", title: "5.3 Preclinical safety data", fields: ["nonclinical_toxicology", "carcinogenesis_and_mutagenesis_and_impairment_of_fertility"] },
  { key: "pharmaceutical", title: "6. Pharmaceutical particulars", fields: ["how_supplied", "how_supplied_table", "storage_and_handling", "package_label_principal_display_panel"] },
  ...OPENFDA_EXTRA_FIELDS,
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n\n");
  return String(value).replace(/\r/g, "").trim();
}

function joinList(arr, sep = ", ") {
  return Array.isArray(arr) ? arr.filter(Boolean).join(sep) : "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const DAILYMED_BASE = "https://dailymed.nlm.nih.gov/";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function absolutizeUrl(url, baseUrl = DAILYMED_BASE) {
  const raw = String(url || "").trim();
  if (!raw || /^data:/i.test(raw)) return raw;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return raw;
  }
}

/** Plain text from HTML — used for search/translation, not for display of tables/images. */
function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " | ")
      .replace(/<(td|th)[^>]*>/gi, "")
      .replace(/<img[^>]*alt=["']([^"']+)["'][^>]*>/gi, "\n[Image: $1]\n")
      .replace(/<img[^>]*>/gi, "\n[Image]\n")
      .replace(/<\/(p|div|li|h\d|summary|section|table|thead|tbody|tfoot|figure|picture)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .trim();
}

function sanitizeRichHtml(html) {
  return String(html || "")
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|form|input|button)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .replace(/\s{2,}/g, " ");
}

function rewriteImgTags(html, baseUrl) {
  return String(html || "").replace(/<img\b([^>]*)>/gi, (_, attrs) => {
    const srcMatch =
      attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || attrs.match(/\bsrc\s*=\s*([^\s>]+)/i);
    if (!srcMatch) return "";
    const src = absolutizeUrl(srcMatch[1].replace(/^["']|["']$/g, ""), baseUrl);
    if (!src || /^javascript:/i.test(src)) return "";
    const altMatch = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" />`;
  });
}

function markdownTablesToHtml(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let i = 0;
  const isRow = (line) => /^\s*\|/.test(line);
  const isSep = (line) => /^\s*\|?\s*:?-{3,}/.test(line);
  const cells = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isRow(lines[i])) {
        if (!isSep(lines[i])) rows.push(cells(lines[i]));
        i += 1;
      }
      if (rows.length) {
        const [header, ...body] = rows;
        const thead = `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
        const tbody = body.length
          ? `<tbody>${body
              .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
              .join("")}</tbody>`
          : "";
        out.push(`<table class="smpc-table">${thead}${tbody}</table>`);
      }
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

function paragraphizeMixed(content) {
  return String(content || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^<(?:table|img|ul|ol|h\d|div)\b/i.test(block)) return block;
      if (/<(?:table|img)\b/i.test(block)) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

/** Build display HTML + plain text; keeps real tables and images. */
function enrichSectionContent(raw, baseUrl = DAILYMED_BASE) {
  let source = String(raw || "").replace(/\r/g, "");
  if (!source.trim()) return { text: "", html: "" };

  // Already HTML-heavy (OpenFDA / eMC / DailyMed HTML path)
  if (/<(?:table|img|thead|tbody|tr|td|th)\b/i.test(source)) {
    let html = rewriteImgTags(source, baseUrl);
    html = html
      .replace(/<\/?(html|head|body|section|article)[^>]*>/gi, "")
      .replace(/<a\b[^>]*>/gi, "")
      .replace(/<\/a>/gi, "");
    // Keep table structure; drop other noisy wrappers lightly
    html = sanitizeRichHtml(html);
    if (!/<(?:p|br|table|img|ul|ol)\b/i.test(html)) {
      html = paragraphizeMixed(html);
    }
    return { text: stripTags(html), html };
  }

  // Markdown / Jina path — recover flattened SpC tables before rendering.
  let md = restoreSpcTablesInMarkdown(source);
  md = md
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, src) => {
      const abs = absolutizeUrl(String(src || "").trim(), baseUrl);
      if (!abs) return "";
      return `\n<img src="${escapeHtml(abs)}" alt="${escapeHtml(alt || "")}" loading="lazy" referrerpolicy="no-referrer" />\n`;
    })
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  md = markdownTablesToHtml(md);
  const hasRich = /<(?:table|img)\b/i.test(md);
  const text = stripTags(md);
  const html = hasRich ? sanitizeRichHtml(paragraphizeMixed(md)) : "";
  return { text, html };
}

function makeSection(title, rawBody, index, baseUrl = DAILYMED_BASE) {
  const { text, html } = enrichSectionContent(rawBody, baseUrl);
  return {
    key: sectionKey(title, index),
    title: String(title || "").trim(),
    text,
    html,
  };
}

function sectionKey(title, index) {
  const slug = slugify(title).slice(0, 48) || `section-${index + 1}`;
  return `${index + 1}-${slug}`;
}

async function fetchWithTimeout(
  url,
  { timeoutMs = 28000, signal, method = "GET", headers = null, body = null } = {}
) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    const init = { method, signal: ctrl.signal, cache: "no-store" };
    if (headers) init.headers = headers;
    if (body != null && method !== "GET" && method !== "HEAD") init.body = body;
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onOuterAbort);
  }
}

function rememberProxy(name) {
  try {
    sessionStorage.setItem(PROXY_PREF_KEY, name);
  } catch {
    /* ignore */
  }
}

function preferredProxyName() {
  try {
    return sessionStorage.getItem(PROXY_PREF_KEY) || "";
  } catch {
    return "";
  }
}

function buildJinaTargets(target) {
  const out = [];
  const push = (value) => {
    const next = String(value || "").trim();
    if (next && !out.includes(next)) out.push(next);
  };
  push(target);
  if (target.startsWith("https://")) push(`http://${target.slice("https://".length)}`);
  if (target.startsWith("http://")) push(`https://${target.slice("http://".length)}`);
  try {
    const u = new URL(target);
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
      push(u.toString());
      if (u.protocol === "https:") {
        u.protocol = "http:";
        push(u.toString());
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function readResponseHeader(headers, name) {
  if (!headers) return "";
  const needle = String(name || "").toLowerCase();
  if (typeof headers.get === "function") {
    return (
      headers.get(name) ||
      headers.get(needle) ||
      headers.get(String(name || "").toUpperCase()) ||
      ""
    );
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === needle && value != null) return String(value);
    }
  }
  return "";
}

/** Low-level Puter fetch with manual redirect following (no queue). */
async function fetchViaPuterRaw(
  url,
  { timeoutMs = 22000, followRedirects = true, puter, method = "GET", headers = null, body = null } = {}
) {
  const client = puter || (await (await import("./puter-auth.js")).loadPuter());
  if (!client?.net?.fetch) throw new Error("puter.net unavailable");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = String(url || "").trim();
    let response = null;
    const verb = String(method || "GET").toUpperCase();
    for (let hop = 0; hop < 8; hop += 1) {
      const init = {
        method: hop === 0 ? verb : "GET",
        signal: ctrl.signal,
        headers: hop === 0 && headers ? headers : { Accept: "*/*" },
        redirect: "manual",
      };
      if (hop === 0 && body != null && verb !== "GET" && verb !== "HEAD") init.body = body;
      response = await client.net.fetch(current, init);
      const status = Number(response?.status || 0);
      if (!(followRedirects && status >= 300 && status < 400)) break;
      let location = readResponseHeader(response.headers, "location");
      if (!location && response?.url && String(response.url) !== current) {
        location = String(response.url);
      }
      if (!location) throw new Error(`HTTP ${status}`);
      current = new URL(location, current).toString();
    }
    if (!response?.ok) throw new Error(`HTTP ${response?.status || "?"}`);
    const text = await response.text();
    if (!text || text.length < 80) throw new Error("empty");
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaPuter(
  url,
  { timeoutMs = 22000, followRedirects = true, method = "GET", headers = null, body = null } = {}
) {
  const run = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchViaPuterRaw(url, { timeoutMs, followRedirects, method, headers, body });
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || "");
        if (/CONNECTING|InvalidStateError|WebSocket|Socket errored/i.test(message) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 350));
          continue;
        }
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const queued = puterFetchQueue.then(run, run);
  puterFetchQueue = queued.catch(() => {});
  return queued;
}

function isUkEmcHost(url) {
  try {
    return /(^|\.)medicines\.org\.uk$/i.test(new URL(url).hostname);
  } catch {
    return /medicines\.org\.uk/i.test(String(url || ""));
  }
}

function jinaReaderUrl(target) {
  return `${JINA_PREFIX}${String(target || "").trim()}`;
}

function buildProxyAttempts(target) {
  const attempts = [];
  for (const variant of buildJinaTargets(target).slice(0, 2)) {
    attempts.push({
      name: "jina",
      timeoutMs: 12000,
      run: () => fetchWithTimeout(jinaReaderUrl(variant), { timeoutMs: 12000 }),
    });
  }
  attempts.push({
    name: "corsproxy-io",
    timeoutMs: 9000,
    run: () =>
      fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(target)}`, {
        timeoutMs: 9000,
      }),
  });
  attempts.push({
    name: "allorigins",
    timeoutMs: 7000,
    run: () =>
      fetchWithTimeout(`${ALLORIGINS_RAW}${encodeURIComponent(target)}`, {
        timeoutMs: 7000,
      }),
  });
  attempts.push({
    name: "allorigins-json",
    timeoutMs: 7000,
    run: async () => {
      const raw = await fetchWithTimeout(
        `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
        { timeoutMs: 7000 }
      );
      const data = JSON.parse(raw);
      if (!data?.contents) throw new Error("empty");
      return String(data.contents);
    },
  });
  return attempts;
}

function acceptRemoteText(text) {
  if (!text || text.length < 80) throw new Error("empty");
  // Reject raw PDF bytes (proxies sometimes return the blob unchanged).
  if (/^%PDF-/i.test(String(text).slice(0, 16))) throw new Error("binary PDF");
  if (isBlockedOrMissing(text)) throw new Error("blocked");
  return text;
}

function isMhraBlobHost(url) {
  try {
    return /mhraproducts\d*\.blob\.core\.windows\.net$/i.test(new URL(url).hostname);
  } catch {
    return /mhraproducts\d*\.blob\.core\.windows\.net/i.test(String(url || ""));
  }
}

/** Loose SpC detection — pdf.js line breaks can split headings across lines. */
function looksLikeUkSpcText(text) {
  const sample = String(text || "").slice(0, 120000);
  if (sample.length < 400) return false;
  if (/SUMMARY OF PRODUCT CHARACTERISTICS/i.test(sample)) return true;
  if (/NAME OF THE MEDICINAL PRODUCT/i.test(sample) && /QUALITATIVE AND QUANTITATIVE/i.test(sample)) {
    return true;
  }
  if (/CLINICAL PARTICULARS/i.test(sample) && /PHARMACEUTICAL (?:FORM|PARTICULARS)/i.test(sample)) {
    return true;
  }
  // Numbered SpC outline even when heading words wrap oddly.
  const nums = (sample.match(/(?:^|\n)\s*([1-9]|10)\s+[A-Z][A-Z \/,()-]{8,}/g) || []).length;
  return nums >= 5;
}

const waybackSnapshotCache = new Map();

/** Prefer raw archived payload (no Wayback toolbar). */
function toWaybackIdentityUrl(snapshotUrl) {
  return String(snapshotUrl || "")
    .replace(/^http:\/\//i, "https://")
    .replace(/\/\/web\.archive\.org\b/i, "//web.archive.org")
    .replace(/\/\/archive\.org\/web\b/i, "//web.archive.org/web")
    .replace(/\/web\/(\d{8,14})(?:[a-z]{1,3}_?)?\//i, "/web/$1id_/");
}

function waybackCandidateUrls(snapshotOrLiveUrl) {
  const raw = String(snapshotOrLiveUrl || "").trim();
  if (!raw) return [];
  const https = raw.replace(/^http:\/\//i, "https://");
  const identity = toWaybackIdentityUrl(https);
  const rawMime = identity.replace(/\/web\/(\d{8,14})id_\//i, "/web/$1im_/");
  const plain = identity.replace(/\/web\/(\d{8,14})id_\//i, "/web/$1/");
  const out = [];
  for (const value of [rawMime, identity, plain, https]) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

async function lookupWaybackClosest(url, { timeoutMs = 9000 } = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("empty url");

  const variants = [
    target,
    target.replace("https://www.", "https://"),
    target.replace(/\/smpc\/?$/i, "/smpc/print"),
    target.replace(/\/smpc\/print\/?$/i, "/smpc"),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  const endpointsFor = (value) => [
    `https://archive.org/wayback/available?url=${encodeURIComponent(value)}`,
    `https://web.archive.org/wayback/available?url=${encodeURIComponent(value)}`,
  ];

  const tryParse = (raw) => {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const snap = data?.archived_snapshots?.closest?.url;
    if (!snap) throw new Error("no snapshot");
    return toWaybackIdentityUrl(snap);
  };

  let lastError = null;

  // Browser first (CORS *) — avoids nested Puter queue calls during hydration.
  for (const value of variants) {
    for (const endpoint of endpointsFor(value)) {
      try {
        const raw = await fetchWithTimeout(endpoint, { timeoutMs: Math.min(timeoutMs, 9000) });
        return tryParse(raw);
      } catch (error) {
        lastError = error;
      }
    }
  }

  // Puter fallback for availability JSON when browser→archive.org is blocked.
  for (const value of variants) {
    for (const endpoint of endpointsFor(value).slice(0, 1)) {
      try {
        const raw = await fetchViaPuter(endpoint, {
          timeoutMs: Math.min(timeoutMs, 12000),
          followRedirects: true,
        });
        return tryParse(raw);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "wayback lookup failed"));
}

/**
 * Resolve a Wayback Machine snapshot for a live URL.
 * Prefer an exact timestamped capture so Puter does not stop at HTTP 302.
 */
async function resolveWaybackSnapshot(url, { timeoutMs = 9000 } = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("empty url");
  if (waybackSnapshotCache.has(target)) return waybackSnapshotCache.get(target);

  const identity = await lookupWaybackClosest(target, { timeoutMs });
  waybackSnapshotCache.set(target, identity);
  return identity;
}

const emcPageCache = new Map();
let waybackCooldownUntil = 0;

function isRateLimitedError(error) {
  return /HTTP\s*429|too many requests|rate limit/i.test(String(error?.message || error || ""));
}

async function fetchViaPuterWayback(target, { timeoutMs = 18000 } = {}) {
  if (Date.now() < waybackCooldownUntil) {
    throw new Error("HTTP 429");
  }
  const errors = [];
  const snap = await resolveWaybackSnapshot(target, { timeoutMs: Math.min(10000, timeoutMs) });

  // One candidate at a time — racing Wayback triggers HTTP 429.
  for (const candidate of waybackCandidateUrls(snap).slice(0, 2)) {
    try {
      return acceptRemoteText(await fetchViaPuter(candidate, { timeoutMs, followRedirects: true }));
    } catch (error) {
      errors.push(`${candidate.slice(0, 56)}:${error?.message || error}`);
      if (isRateLimitedError(error)) {
        waybackCooldownUntil = Date.now() + 60000;
        break;
      }
    }
  }
  throw new Error(errors.slice(0, 3).join(" · ") || "wayback fetch failed");
}

/**
 * Fetch a remote page without CORS.
 *
 * MHRA SpC PDFs: Puter→PDF bytes→pdf.js (Azure blob has no CORS; Jina often 403).
 * Legacy medicines.org.uk: Puter→Jina, then a single Puter→Wayback hop (no Wayback race).
 */
async function fetchRemotePage(url, { preferHtml = false, timeoutMs = 18000 } = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("رابط المصدر فارغ.");
  void preferHtml;

  if (emcPageCache.has(target)) {
    return { text: emcPageCache.get(target), via: "cache" };
  }

  const errors = [];
  const pref = preferredProxyName();
  const budget = Math.max(9000, Math.min(timeoutMs, 24000));
  const ukEmc = isUkEmcHost(target);
  const mhraPdf = isMhraBlobHost(target);
  const cacheable = ukEmc || mhraPdf;

  const remember = (via, text) => {
    rememberProxy(via);
    if (cacheable && text && text.length > 500) {
      emcPageCache.set(target, text);
      try {
        sessionStorage.setItem(`smpc_emc_page_v2_${target}`, text.slice(0, 450000));
      } catch {
        /* ignore quota */
      }
    }
    return { text, via };
  };

  if (cacheable) {
    try {
      const cached = sessionStorage.getItem(`smpc_emc_page_v2_${target}`);
      if (cached && cached.length > 500) {
        emcPageCache.set(target, cached);
        return { text: cached, via: "session-cache" };
      }
    } catch {
      /* ignore */
    }
  }

  // MHRA Azure blobs have no CORS. Jina from the browser often fails (CORS / Puter→Jina 403).
  // Primary path: Puter → PDF bytes → pdf.js text layer.
  if (mhraPdf) {
    try {
      const pdfBytes = await fetchMhraPdfBytes(target, { timeoutMs: Math.min(budget + 10000, 40000) });
      const text = acceptRemoteText(await extractPdfTextLayer(pdfBytesToArrayBuffer(pdfBytes)));
      if (!looksLikeUkSpcText(text)) throw new Error("not SpC text");
      mhraPdfBytesCache.set(target, pdfBytes);
      return remember("puter-pdfjs-mhra", text);
    } catch (error) {
      errors.push(`puter-pdfjs-mhra: ${error?.message || error}`);
    }

    // Last-resort text readers (often blocked; keep for environments where they still work).
    for (const variant of buildJinaTargets(target).slice(0, 1)) {
      try {
        const text = acceptRemoteText(
          await fetchWithTimeout(jinaReaderUrl(variant), { timeoutMs: Math.min(budget, 16000) })
        );
        if (!looksLikeUkSpcText(text)) throw new Error("not SpC text");
        return remember("jina-mhra", text);
      } catch (error) {
        errors.push(`jina-mhra: ${error?.message || error}`);
      }
    }

    throw new Error(
      `تعذّر قراءة PDF من MHRA. ${errors.slice(0, 3).join(" · ")}`
    );
  }

  if (ukEmc) {
    if (pref !== "skip-puter") {
      for (const variant of buildJinaTargets(target).slice(0, 1)) {
        try {
          const text = acceptRemoteText(
            await fetchViaPuter(jinaReaderUrl(variant), { timeoutMs: Math.min(budget, 16000) })
          );
          return remember("puter-jina", text);
        } catch (error) {
          errors.push(`puter-jina: ${error?.message || error}`);
        }
      }

      if (Date.now() >= waybackCooldownUntil) {
        try {
          const text = await fetchViaPuterWayback(target, { timeoutMs: Math.min(budget, 20000) });
          return remember("puter-wayback", text);
        } catch (error) {
          errors.push(`puter-wayback: ${error?.message || error}`);
          if (isRateLimitedError(error)) waybackCooldownUntil = Date.now() + 60000;
        }
      } else {
        errors.push("puter-wayback: HTTP 429 (cooldown)");
      }
    }

    throw new Error(
      `تعذّر جلب الصفحة عبر كل الوسطاء. جرّب مصدراً آخر أو أعد المحاولة بعد قليل. التفاصيل: ${errors.slice(0, 4).join(" · ")}`
    );
  }

  const attempts = [];
  if (pref !== "skip-puter") {
    const jinaTargets = buildJinaTargets(target).slice(0, 2);
    for (const variant of jinaTargets) {
      attempts.push({
        name: "puter-jina",
        run: async () =>
          acceptRemoteText(
            await fetchViaPuter(jinaReaderUrl(variant), {
              timeoutMs: Math.min(budget, 14000),
            })
          ),
      });
    }
    attempts.push({
      name: "puter",
      run: async () =>
        acceptRemoteText(await fetchViaPuter(target, { timeoutMs: Math.min(budget, 12000) })),
    });
  }
  for (const attempt of buildProxyAttempts(target)) attempts.push(attempt);
  if (pref) {
    attempts.sort((a, b) => Number(b.name.startsWith(pref)) - Number(a.name.startsWith(pref)));
  }

  const racePool = attempts.slice(0, 4);
  try {
    const winner = await Promise.any(
      racePool.map(async (attempt) => {
        const text = acceptRemoteText(await attempt.run());
        return { text, via: attempt.name };
      })
    );
    return remember(winner.via, winner.text);
  } catch (error) {
    const details =
      error?.errors?.map((e) => e?.message || e).join(", ") || error?.message || "race failed";
    errors.push(`proxy-race: ${details}`);
  }

  for (const attempt of attempts.slice(racePool.length)) {
    try {
      const text = acceptRemoteText(await attempt.run());
      return remember(attempt.name, text);
    } catch (error) {
      errors.push(`${attempt.name}: ${error?.message || error}`);
    }
  }

  throw new Error(
    `تعذّر جلب الصفحة عبر كل الوسطاء. جرّب مصدراً آخر أو أعد المحاولة بعد قليل. التفاصيل: ${errors.slice(0, 5).join(" · ")}`
  );
}

/** @deprecated use fetchRemotePage */
async function fetchJina(url, { format = "markdown" } = {}) {
  const { text } = await fetchRemotePage(url, { preferHtml: format === "html" });
  return text;
}

function isBlockedOrMissing(text) {
  const sample = String(text || "").slice(0, 1500);
  return (
    /Access Denied/i.test(sample) ||
    /Page Not Found \(404\)/i.test(sample) ||
    /HTTP Error 403/i.test(sample) ||
    /could not find the page/i.test(sample) ||
    /Sorry, we couldn't find that page/i.test(sample) ||
    (/Title:\s*Access Denied/i.test(sample) && sample.length < 2000)
  );
}

function scoreLabelSections(sections) {
  if (!sections?.length) return 0;
  const chars = sections.reduce(
    (n, s) => n + String(s.text || "").length + String(s.html || "").length,
    0
  );
  const clinical = sections.filter((s) =>
    /indication|dosage|warning|adverse|interaction|contraindic|pharmacolog|overdose|description|clinical|composition|posology/i.test(
      s.title
    )
  ).length;
  const rich = sections.filter((s) => /<(?:table|img)\b/i.test(s.html || "")).length;
  return sections.length * 10 + Math.min(chars, 400000) / 200 + clinical * 25 + rich * 50;
}

function finalizeDailyMedDoc(doc, sections, sourceNote) {
  return {
    ...doc,
    sourceLabel: sourceNote || "DailyMed",
    sections,
    englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
    hydrated: true,
    needsFullLabel: false,
    url:
      doc.setId
        ? `https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=${doc.setId}&type=display`
        : doc.url,
  };
}

/** Prefer raw HTML proxies (skip Jina markdown) so tables/images survive. */
async function fetchRemoteHtmlPrefer(url) {
  try {
    const hit = await fetchRemotePage(url, { preferHtml: true, timeoutMs: 16000 });
    if (hit?.text && /<(?:html|table|img|div|h[1-4])\b/i.test(hit.text)) {
      return hit;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseDailyMedHtmlSections(html, setId) {
  const baseUrl = setId
    ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`
    : DAILYMED_BASE;
  let content = String(html || "");
  const start = content.search(
    /<(?:div|section)[^>]*(?:id|class)=["'][^"']*(?:drug-information|spl|content|Section|main)[^"']*["'][^>]*>/i
  );
  if (start > 0) content = content.slice(start);
  content = content
    .split(/<(?:footer|nav)\b/i)[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const sections = [];
  const headingRe = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const hits = [];
  let match;
  while ((match = headingRe.exec(content))) {
    hits.push({ index: match.index, end: headingRe.lastIndex, level: Number(match[1]), rawTitle: match[2] });
  }
  if (hits.length < 3) {
    // Fallback: class="Section" blocks
    const sectionRe =
      /<(?:div|section)[^>]*class=["'][^"']*Section[^"']*["'][^>]*>([\s\S]*?)(?=<(?:div|section)[^>]*class=["'][^"']*Section[^"']*["']|$)/gi;
    let sm;
    while ((sm = sectionRe.exec(content))) {
      const block = sm[1];
      const titleMatch = block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
      const title = stripTags(titleMatch?.[1] || "").trim();
      if (!title || title.length < 3) continue;
      const bodyHtml = titleMatch ? block.slice(block.indexOf(titleMatch[0]) + titleMatch[0].length) : block;
      sections.push(makeSection(title, bodyHtml, sections.length, baseUrl));
    }
    return sections.filter((s) => s.text.length >= 12 || s.html);
  }

  for (let i = 0; i < hits.length; i += 1) {
    const title = stripTags(hits[i].rawTitle).trim();
    if (!title || title.length < 2) continue;
    if (
      /^(skip to|table of contents|search|share|print|rss|disclaimer|contact us|version:)/i.test(title)
    ) {
      continue;
    }
    const bodyHtml = content.slice(hits[i].end, hits[i + 1]?.index ?? content.length);
    const section = makeSection(title, bodyHtml, sections.length, baseUrl);
    if (section.text.length >= 8 || section.html) sections.push(section);
  }
  return sections;
}

async function hydrateFromOpenFdaSetId(doc) {
  const setId = String(doc?.setId || "").trim();
  if (!setId) return null;
  try {
    const results = await fetchOpenFda(`set_id:"${setId}"`, 1);
    if (!results.length) return null;
    const full = normalizeOpenFda(results[0]);
    if (!full.sections?.length) return null;
    return {
      ...full,
      id: doc.id || full.id,
      source: doc.source || "dailymed",
      sourceLabel: doc.source === "drugs" ? "drugs.com ≈ OpenFDA label" : "DailyMed / OpenFDA",
      title: doc.title || full.title,
      url: doc.url || full.url,
      hydrated: true,
      needsFullLabel: false,
      fetchVia: "openfda",
    };
  } catch {
    return null;
  }
}

async function hydrateDailyMedFull(doc) {
  if (!doc?.setId && !doc?.title && !doc?.api) return doc;

  // 1) OpenFDA first — CORS * and no proxy required.
  // Keep it as a candidate only: OpenFDA often omits table/figure-heavy sections,
  // so we still try DailyMed HTML/XSL when a setId is available and pick the richer copy.
  const fromFda = await hydrateFromOpenFdaSetId(doc);

  if (!doc?.setId) {
    // Try resolving a set id via OpenFDA name search, then hydrate.
    const hints = [doc.title, doc.api, doc.slug?.replace(/-/g, " ")].filter(Boolean);
    for (const hint of hints) {
      for (const expr of buildQueryVariants(hint).slice(0, 2)) {
        try {
          const batch = await fetchOpenFda(expr, 1);
          if (!batch.length) continue;
          const full = normalizeOpenFda(batch[0]);
          if (full.sections?.length >= 5) {
            return {
              ...full,
              id: doc.id || full.id,
              source: doc.source || "dailymed",
              title: doc.title || full.title,
              url: doc.url || full.url,
              hydrated: true,
              needsFullLabel: false,
              fetchVia: "openfda",
            };
          }
        } catch {
          /* next */
        }
      }
    }
    return fromFda || doc;
  }

  const urls = [
    {
      url: `https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=${doc.setId}&type=display`,
      label: "DailyMed (XSL / print-style)",
      preferNumbered: false,
    },
    {
      url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${doc.setId}&type=print`,
      label: "DailyMed (print)",
      preferNumbered: true,
    },
    {
      url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${doc.setId}`,
      label: "DailyMed",
      preferNumbered: true,
    },
  ];

  let best = null;
  const baseUrl = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${doc.setId}`;

  for (const candidate of urls) {
    try {
      // Prefer raw HTML so tables and product images are not flattened away.
      const htmlHit = await fetchRemoteHtmlPrefer(candidate.url);
      if (htmlHit?.text) {
        let sections = parseDailyMedHtmlSections(htmlHit.text, doc.setId);
        if (sections.length >= 4) {
          const score = scoreLabelSections(sections) + 120;
          if (!best || score > best.score) {
            best = {
              sections,
              score,
              label: `${candidate.label} HTML`,
              url: candidate.url,
            };
          }
          if (sections.length >= 10 && score > 900) break;
          continue;
        }
      }

      const { text: markdown } = await fetchRemotePage(candidate.url);
      if (isBlockedOrMissing(markdown) || markdown.length < 1500) continue;

      let sections = parseMarkdownSections(markdown, {
        minBody: 8,
        requireNumbered: false,
        baseUrl,
      });
      if (sections.length < 4) {
        sections = parseMarkdownSections(markdown, {
          minBody: 8,
          requireNumbered: candidate.preferNumbered,
          baseUrl,
        });
      }
      // Keep nearly all real label sections — do not trim clinical bodies.
      sections = sections.filter((section) => {
        if (section.html) return true;
        if (section.text.length >= 12) return true;
        return /^\d+(?:\.\d+)*\b/.test(section.title);
      });

      const score = scoreLabelSections(sections);
      if (!best || score > best.score) {
        best = { sections, score, label: candidate.label, url: candidate.url };
      }
      if (sections.length >= 12 && score > 800) break;
    } catch {
      /* try next URL */
    }
  }

  if (best?.sections?.length >= 3) {
    const htmlDoc = finalizeDailyMedDoc({ ...doc, url: best.url }, best.sections, best.label);
    const htmlScore = scoreLabelSections(htmlDoc.sections);
    const fdaScore = scoreLabelSections(fromFda?.sections);
    // Prefer DailyMed HTML/markdown whenever it is at least roughly as rich as OpenFDA.
    if (fromFda?.sections?.length && fdaScore > htmlScore * 1.35 && htmlScore < 400) {
      return fromFda;
    }
    if (fromFda?.sections?.length) {
      const have = new Set(htmlDoc.sections.map((s) => s.title.toLowerCase()));
      const extras = fromFda.sections.filter(
        (s) => !have.has(String(s.title || "").toLowerCase()) && (s.text?.length > 40 || s.html)
      );
      if (extras.length) {
        const merged = [...htmlDoc.sections, ...extras];
        return finalizeDailyMedDoc({ ...doc, url: best.url }, merged, `${best.label} + OpenFDA`);
      }
    }
    return htmlDoc;
  }

  if (fromFda?.sections?.length) return fromFda;
  return doc;
}

function parseMarkdownSections(
  markdown,
  { minBody = 12, requireNumbered = false, baseUrl = DAILYMED_BASE } = {}
) {
  const text = String(markdown || "")
    .replace(/\r/g, "")
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Markdown Content:\s*/m, "")
    .trim();

  // Prefer the body that starts at the first real label/SmPC heading
  const startMatchers = [
    /(?:^|\n)#{1,4}\s+FULL PRESCRIBING INFORMATION\b[^\n]*/im,
    /(?:^|\n)#{1,4}\s+\d{1,2}(?:\.\d+){0,3}\s+[A-Z][^\n[\]]{3,120}\s*$/m,
    /(?:^|\n)(#{1,4}\s+)?(BOXED WARNING[^\n]*)/im,
    /(?:^|\n)(#{1,4}\s+)?(HIGHLIGHTS OF PRESCRIBING INFORMATION[^\n]*)/im,
    /(?:^|\n)(#{1,4}\s+)?(1\s+INDICATIONS AND USAGE[^\n]*)/im,
    /(?:^|\n)(#{1,4}\s+)?(1\.\s*Name of the medicinal product[^\n]*)/im,
    /(?:^|\n)(#{1,4}\s+)?([^\n]*\bDescription)\s*$/im,
    /(?:^|\n)(#{1,4}\s+)?(Active ingredient[^\n]*)/im,
  ];
  let body = text;
  for (const re of startMatchers) {
    const hit = text.search(re);
    if (hit >= 0) {
      body = text.slice(hit);
      break;
    }
  }

  const plainBody = body.search(/^#{1,4}\s+\d{1,2}(?:\.\d+){0,3}\s+[A-Z][^\n[\]]{3,120}\s*$/m);
  if (plainBody > 0) {
    const linkedBefore = (body.slice(0, plainBody).match(/^#{1,4}\s+\[[^\]]+\]\([^)]+\)/gm) || [])
      .length;
    if (linkedBefore >= 3) body = body.slice(plainBody);
  }

  // Only drop commercial site chrome footers — never cut mid-label content by length.
  body = body.split(
    /\n#{1,4}\s+(?:Related\/similar drugs|Frequently asked questions|More about |Professional resources|Other brands|Related treatment guides|Patient resources)\b/i
  )[0];

  const lines = body.split("\n");
  const sections = [];
  let current = null;

  const isHeading = (line) => {
    if (/^#{1,4}\s+\[[^\]]+\]\([^)]*$/.test(line)) return "";
    const h = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (h) {
      let title = h[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/^\[[^\]]*\]\([^)]*\)/, "")
        .trim();
      if (title.includes("](") || title.startsWith("[")) return "";
      return title;
    }
    // EU SmPC: "1. Title" or subsection "4.1 Title". US DailyMed often uses "1 TITLE".
    const numbered =
      line.match(/^((?:\d{1,2}\.\d+(?:\.\d+){0,2})|(?:\d{1,2})\.)\s+([A-Z][\s\S]{2,160})$/) ||
      line.match(/^(\d{1,2}(?:\.\d+){0,3})\s+([A-Z][A-Z0-9][\s\S]{2,140})$/);
    if (numbered) {
      const num = String(numbered[1] || "").replace(/\.$/, "");
      const major = Number(num.split(".")[0]);
      const title = `${num} ${numbered[2]}`.replace(/\s+/g, " ").trim();
      // Reject body lines like "36 months." accidentally treated as headings.
      if (/^\d{1,2}(?:\.\d+)*\s+[a-z]/.test(title)) return "";
      if (major >= 1 && major <= 16 && title.length >= 5) return title;
    }
    return "";
  };

  const junkHeading = (title) => {
    const t = String(title || "").trim();
    if (t.length < 3) return true;
    if (/^https?:\/\//i.test(t)) return true;
    if (/^\d+\s+TABLETS?\b/i.test(t)) return true;
    if (/\bU\.S\.A\.\s*$/i.test(t)) return true;
    return /^(label:|view package|drug label info|safety$|related resources|more info|skip to|view more|find additional|number of versions|recent major changes|table of contents|full prescribing information: contents|disclaimer|contact|search drugs|browse medications|related\/similar drugs|frequently asked questions|more about|professional resources|other brands|related treatment guides|patient resources|more info on this drug|to receive this label|to receive all dailymed|what will i get with the dailymed|how to discontinue|why is dailymed|version:|rss feed)/i.test(
      t
    );
  };

  for (const line of lines) {
    const heading = isHeading(line);
    if (heading) {
      if (junkHeading(heading)) continue;
      if (
        requireNumbered &&
        !/^\d+(?:\.\d+)*\b/.test(heading) &&
        !/HIGHLIGHTS|BOXED WARNING|DESCRIPTION|CLINICAL|INDICATIONS|DOSAGE|CONTRAINDICATIONS|WARNINGS|ADVERSE|DRUG INTERACTIONS|USE IN SPECIFIC|OVERDOSAGE|HOW SUPPLIED|PATIENT COUNSELING/i.test(
          heading
        )
      ) {
        continue;
      }
      if (current && current.text.trim().length >= minBody) sections.push(current);
      current = { title: heading, text: "" };
      continue;
    }
    if (!current) continue;
    current.text += `${line}\n`;
  }
  if (current && current.text.trim()) sections.push(current);

  return sections
    .map((section, index) => makeSection(section.title, section.text, index, baseUrl))
    .filter((section) => {
      if (section.html) return true;
      if (section.text.length >= minBody) return true;
      return /\[Image:/i.test(section.text) || /\s\|\s/.test(section.text);
    });
}

function isEmcSectionTitle(title) {
  return (
    /^\d+(\.\d+)*\b/.test(title) ||
    /name of the medicinal|composition|pharmaceutical|clinical|indication|posology|contraindic|warning|interaction|pregnancy|undesirable|overdose|pharmacolog|marketing authorisation|excipient|shelf|storage|packag|nature and contents|qualitative|quantitative/i.test(
      title
    )
  );
}

function parseEmcHtml(html) {
  const start = html.search(/id=["']smpc["']|class=["']spcWrapper["']|id=["']product-smpc["']/i);
  const block = start >= 0 ? html.slice(start) : html;
  const sections = [];
  const seen = new Set();

  const pushSection = (rawTitle, rawBody) => {
    const title = stripTags(rawTitle);
    if (!title) return;
    if (/my account|cookie|sign in|accept all|expand all|print smpc|share/i.test(title)) return;
    if (!isEmcSectionTitle(title)) return;
    const rich = enrichSectionContent(rawBody, "https://www.medicines.org.uk/");
    const key = title.toLowerCase();
    if (seen.has(key)) {
      const existing = sections.find((s) => s.title.toLowerCase() === key);
      if (existing && rich.text && !existing.text.includes(rich.text.slice(0, 80))) {
        existing.text = `${existing.text}\n\n${rich.text}`.trim();
        if (rich.html) {
          existing.html = `${existing.html || ""}\n${rich.html}`.trim();
        }
      }
      return;
    }
    seen.add(key);
    sections.push({
      key: sectionKey(title, sections.length),
      title,
      text: rich.text || "(See subsections below.)",
      html: rich.html || "",
    });
  };

  // Primary eMC accordion pattern.
  const detailRe =
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let match;
  while ((match = detailRe.exec(block))) {
    pushSection(match[1], match[2]);
  }

  // Fallback: numbered headings wrapping content until the next heading.
  if (sections.length < 5) {
    const headingRe =
      /<h([2-4])[^>]*>\s*(\d+(?:\.\d+)*\s+[^<]{3,160})\s*<\/h\1>([\s\S]*?)(?=<h[2-4]\b|$)/gi;
    while ((match = headingRe.exec(block))) {
      pushSection(match[2], match[3]);
    }
  }

  return sections;
}

function parseDrugsComMarkdown(markdown) {
  let sections = parseMarkdownSections(markdown, { minBody: 25 });
  // Drop repeated package-panel noise often appended to drugs.com/pro pages
  sections = sections.filter(
    (section) =>
      !/^(Package\/Label Display Panel|\d+\s+TABLETS?|PRINCIPAL DISPLAY PANEL)$/i.test(section.title) &&
      section.text.length >= 40
  );
  if (sections.length >= 4) return sections;

  const body = String(markdown || "")
    .replace(/^[\s\S]*?Markdown Content:\s*/i, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .trim();
  if (!body || isBlockedOrMissing(body)) return [];
  return [
    {
      key: "full-insert",
      title: "Prescribing information",
      text: body.slice(0, 200000),
    },
  ];
}

async function fetchOpenFda(searchExpr, limit = 8) {
  const url = `${OPENFDA_LABEL}?search=${encodeURIComponent(searchExpr)}&limit=${limit}`;
  const response = await fetch(url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`OpenFDA (${response.status})`);
  const data = await response.json();
  return data.results || [];
}


export function normalizeSmpcFilters(raw = {}) {
  const num = Number(raw.packagingCount);
  return {
    formulation: String(raw.formulation || "").trim(),
    manufacturer: String(raw.manufacturer || "").trim(),
    packagingType: String(raw.packagingType || "").trim(),
    packagingCount: Number.isFinite(num) && num > 0 ? Math.round(num) : "",
    atc: String(raw.atc || "").trim(),
    route: String(raw.route || "").trim(),
    strength: String(raw.strength || "").trim(),
    productType: String(raw.productType || "").trim(),
  };
}

export function hasActiveSmpcFilters(filters = {}) {
  const f = normalizeSmpcFilters(filters);
  return Boolean(
    f.formulation ||
      f.manufacturer ||
      f.packagingType ||
      f.packagingCount ||
      f.atc ||
      f.route ||
      f.strength ||
      f.productType
  );
}

function quoteFda(value) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function parsePackagingMeta(packaging = []) {
  const items = Array.isArray(packaging) ? packaging : [];
  return items.map((item) => {
    const description = String(item?.description || "");
    const countMatch = description.match(/^(\d+)\b/);
    const typeMatch = description.match(/\b(?:in|IN)\s+1\s+([A-Z][A-Z ,/-]*)/i) ||
      description.match(/\b(BOTTLE|BLISTER|CARTON|VIAL|AMPULE|AMPOULE|SYRINGE|TUBE|POUCH|BAG|CAN|JAR)\b/i);
    return {
      description,
      count: countMatch ? Number(countMatch[1]) : null,
      type: typeMatch ? String(typeMatch[1]).replace(/,.*/, "").trim().toUpperCase() : "",
      ndc: item?.package_ndc || "",
    };
  });
}

function matchesPackagingFilters(packagingMeta, filters) {
  const f = normalizeSmpcFilters(filters);
  if (!f.packagingType && !f.packagingCount) return true;
  if (!packagingMeta.length) return false;
  return packagingMeta.some((pkg) => {
    const typeOk = !f.packagingType || (pkg.type && pkg.type.includes(f.packagingType.toUpperCase())) ||
      (pkg.description && pkg.description.toUpperCase().includes(f.packagingType.toUpperCase()));
    const countOk = !f.packagingCount || Number(pkg.count) === Number(f.packagingCount) ||
      (pkg.description && new RegExp(`(^|\\b)${f.packagingCount}\\b`).test(pkg.description));
    return typeOk && countOk;
  });
}

function buildNdcSearchExpr(query, filters = {}) {
  const f = normalizeSmpcFilters(filters);
  const parts = [];
  const q = String(query || "").trim();
  if (q) {
    const escaped = q.replace(/"/g, '\\"');
    parts.push(`(generic_name:${quoteFda(escaped)} OR brand_name:${quoteFda(escaped)} OR substance_name:${quoteFda(escaped)})`);
  }
  if (f.formulation) parts.push(`dosage_form:${quoteFda(f.formulation)}`);
  if (f.manufacturer) parts.push(`labeler_name:${quoteFda(f.manufacturer)}`);
  if (f.route) parts.push(`route:${quoteFda(f.route)}`);
  if (f.productType) parts.push(`product_type:${quoteFda(f.productType)}`);
  if (f.strength) parts.push(`active_ingredients.strength:${quoteFda(f.strength)}`);
  if (f.packagingType) parts.push(`packaging.description:${quoteFda(f.packagingType)}`);
  if (f.packagingCount) parts.push(`packaging.description:${quoteFda(String(f.packagingCount))}`);
  // FDA pharm_class approximates therapeutic/ATC grouping; free-text ATC codes also search here.
  if (f.atc) parts.push(`pharm_class:${quoteFda(f.atc)}`);
  return parts.join(" AND ");
}

async function fetchOpenFdaNdc(searchExpr, limit = 12) {
  if (!searchExpr) return [];
  const url = `${OPENFDA_NDC}?search=${encodeURIComponent(searchExpr)}&limit=${limit}`;
  const response = await fetch(url);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`OpenFDA NDC (${response.status})`);
  const data = await response.json();
  return data.results || [];
}

function normalizeNdcResult(item, { source = "dailymed" } = {}) {
  const openfda = item.openfda || {};
  const setIds = openfda.spl_set_id || [];
  const setId = Array.isArray(setIds) ? setIds[0] || "" : String(setIds || "");
  const brand = item.brand_name || item.brand_name_base || "";
  const generic = item.generic_name || "";
  const form = item.dosage_form || "";
  const route = Array.isArray(item.route) ? item.route.join(", ") : item.route || "";
  const manufacturer = item.labeler_name || joinList(openfda.manufacturer_name);
  const packagingMeta = parsePackagingMeta(item.packaging || []);
  const pharmClass = Array.isArray(item.pharm_class) ? item.pharm_class.join(" · ") : "";
  const strength = Array.isArray(item.active_ingredients)
    ? item.active_ingredients
        .map((ing) => [ing.name, ing.strength].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(" · ")
    : "";
  const packageSummary = packagingMeta
    .slice(0, 3)
    .map((pkg) => pkg.description)
    .filter(Boolean)
    .join(" | ");

  const title = brand || generic || "Untitled product";
  const idBase = setId || item.product_ndc || slugify(title);
  return {
    id: `${source}:${idBase}:${item.product_ndc || slugify(packageSummary || title)}`,
    source,
    sourceLabel: source === "drugs" ? "drugs.com" : "DailyMed / OpenFDA NDC",
    title,
    api: generic,
    formulation: [form, strength, route].filter(Boolean).join(" · "),
    manufacturer,
    setId,
    url:
      source === "drugs"
        ? `https://www.drugs.com/pro/${slugify(brand || generic)}.html`
        : setId
          ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`
          : "https://dailymed.nlm.nih.gov/",
    sections: [],
    englishText: title,
    needsFullLabel: Boolean(setId),
    hydrated: false,
    packagingType: packagingMeta.map((p) => p.type).filter(Boolean).join(", "),
    packagingCount: packagingMeta.map((p) => p.count).filter((n) => n != null).join(", "),
    packagingSummary: packageSummary,
    pharmClass,
    strength,
    route,
    productType: item.product_type || "",
    productNdc: item.product_ndc || "",
  };
}

async function searchByNdcFilters(query, { limit = 8, source = "dailymed", filters = {} } = {}) {
  const expr = buildNdcSearchExpr(query, filters);
  if (!expr) return [];
  const rows = await fetchOpenFdaNdc(expr, Math.min(Math.max(limit * 3, 12), 40));
  const f = normalizeSmpcFilters(filters);
  const seen = new Set();
  const out = [];

  for (const item of rows) {
    const packagingMeta = parsePackagingMeta(item.packaging || []);
    if (!matchesPackagingFilters(packagingMeta, f)) continue;
    const doc = normalizeNdcResult(item, { source });
    const key = `${doc.setId || doc.productNdc}|${doc.packagingSummary}|${doc.manufacturer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(doc);
    if (out.length >= limit) break;
  }
  return out;
}

const UK_TO_US_DRUG_NAMES = {
  paracetamol: "acetaminophen",
  adrenaline: "epinephrine",
  noradrenaline: "norepinephrine",
  salbutamol: "albuterol",
  frusemide: "furosemide",
  furosemide: "furosemide",
  bendrofluazide: "bendroflumethiazide",
  lignocaine: "lidocaine",
  pethidine: "meperidine",
  carbamazepine: "carbamazepine",
  amoxycillin: "amoxicillin",
  ciclosporin: "cyclosporine",
  cyclosporin: "cyclosporine",
  rifampicin: "rifampin",
  phenobarbitone: "phenobarbital",
  dothiepin: "dosulepin",
  methadone: "methadone",
  morphine: "morphine",
  ibuprofen: "ibuprofen",
  aspirin: "aspirin",
  metformin: "metformin",
  amlodipine: "amlodipine",
  omeprazole: "omeprazole",
  atorvastatin: "atorvastatin",
  simvastatin: "simvastatin",
  losartan: "losartan",
  ramipril: "ramipril",
  sertraline: "sertraline",
  fluoxetine: "fluoxetine",
  warfarin: "warfarin",
  digoxin: "digoxin",
  prednisolone: "prednisolone",
  levothyroxine: "levothyroxine",
  insulin: "insulin",
};

function expandUkDrugHints(rawHint) {
  const hint = String(rawHint || "").replace(/\s+/g, " ").trim();
  if (!hint) return [];
  const out = [];
  const push = (value) => {
    const next = String(value || "").replace(/\s+/g, " ").trim();
    if (next.length >= 3 && !out.includes(next)) out.push(next);
  };

  push(hint);
  push(hint.split(/[-–|:(,/]/)[0]);
  push(hint.replace(/\b\d+([.,]\d+)?\s*(mg|mcg|µg|g|ml|%|iu|units?)\b/gi, " "));
  push(hint.replace(/\b(tablets?|capsules?|injection|solution|suspension|cream|ointment|gel|syrup|smpc|emc)\b/gi, " "));

  const token = hint
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .find((part) => part.length >= 4);
  if (token) {
    push(token);
    const mapped = UK_TO_US_DRUG_NAMES[token];
    if (mapped) push(mapped);
  }

  // Map any known UK INN appearing anywhere in the hint.
  for (const [uk, us] of Object.entries(UK_TO_US_DRUG_NAMES)) {
    if (new RegExp(`\\b${uk}\\b`, "i").test(hint)) {
      push(uk);
      push(us);
    }
  }
  return out;
}

function buildQueryVariants(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const escaped = q.replace(/"/g, '\\"');
  return [
    `openfda.generic_name:"${escaped}"`,
    `openfda.brand_name:"${escaped}"`,
    `openfda.substance_name:"${escaped}"`,
    `active_ingredient:"${escaped}"`,
  ];
}

function matchesClientFilters(doc, filters = {}) {
  const f = normalizeSmpcFilters(filters);
  if (!hasActiveSmpcFilters(f)) return true;
  const blob = [
    doc.title,
    doc.api,
    doc.formulation,
    doc.manufacturer,
    doc.packagingType,
    doc.packagingCount,
    doc.packagingSummary,
    doc.pharmClass,
    doc.strength,
    doc.route,
    doc.productType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const checks = [
    f.formulation,
    f.manufacturer,
    f.packagingType,
    f.atc,
    f.route,
    f.strength,
    f.productType,
  ];
  for (const needle of checks) {
    if (needle && !blob.includes(String(needle).toLowerCase())) return false;
  }
  if (f.packagingCount) {
    const pack = String(doc.packagingSummary || doc.packagingCount || blob);
    const countOk =
      new RegExp(`(^|\\b)${f.packagingCount}\\b`).test(pack) ||
      String(doc.packagingCount || "")
        .split(/[,|]/)
        .map((s) => s.trim())
        .includes(String(f.packagingCount));
    if (!countOk) return false;
  }
  return true;
}

function appendFilterKeywords(query, filters = {}) {
  const f = normalizeSmpcFilters(filters);
  return [query, f.formulation, f.manufacturer, f.packagingType, f.packagingCount, f.atc, f.route, f.strength]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeOpenFda(item) {
  const fda = item.openfda || {};
  const brand = joinList(fda.brand_name);
  const generic = joinList(fda.generic_name) || joinList(fda.substance_name);
  const form = joinList(fda.dosage_form);
  const route = joinList(fda.route);
  const strength = joinList(fda.strength);
  const manufacturer = joinList(fda.manufacturer_name);

  const sections = SECTION_MAP.map((section) => {
    if (section.key === "product_overview") {
      const lines = [
        brand ? `Brand / Invented name: ${brand}` : "",
        generic ? `Active substance (API): ${generic}` : "",
        form ? `Pharmaceutical form: ${form}` : "",
        strength ? `Strength: ${strength}` : "",
        route ? `Route: ${route}` : "",
        manufacturer ? `Marketing authorisation holder / Manufacturer: ${manufacturer}` : "",
        item.set_id ? `DailyMed / SPL set_id: ${item.set_id}` : "",
      ].filter(Boolean);
      return { key: section.key, title: section.title, text: lines.join("\n"), html: "" };
    }
    const raw = section.fields.map((field) => asText(item[field])).filter(Boolean).join("\n\n");
    if (!raw) return { key: section.key, title: section.title, text: "", html: "" };
    const rich = enrichSectionContent(raw, DAILYMED_BASE);
    return { key: section.key, title: section.title, text: rich.text, html: rich.html };
  }).filter((section) => section.text || section.html);

  // Catch-all: any remaining lengthy OpenFDA string fields not already mapped
  const used = new Set(SECTION_MAP.flatMap((section) => section.fields));
  Object.keys(item)
    .filter((key) => !used.has(key) && !["openfda", "set_id", "id", "version", "effective_time"].includes(key))
    .forEach((key) => {
      const raw = asText(item[key]);
      if (raw.length < 40) return;
      if (sections.some((section) => section.text.includes(raw.slice(0, 80)))) return;
      const rich = enrichSectionContent(raw, DAILYMED_BASE);
      sections.push({
        key: sectionKey(key, sections.length),
        title: key.replace(/_/g, " "),
        text: rich.text,
        html: rich.html,
      });
    });

  return {
    id: `dailymed:${item.set_id || item.id}`,
    source: "dailymed",
    sourceLabel: "DailyMed / OpenFDA",
    title: brand || generic || "Untitled product",
    api: generic,
    formulation: [form, strength, route].filter(Boolean).join(" · "),
    manufacturer,
    setId: item.set_id || "",
    url: item.set_id
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.set_id}`
      : "https://dailymed.nlm.nih.gov/",
    sections,
    englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
    hydrated: true,
  };
}

function normalizeDailyMedListing(item) {
  const title = item.title || item.spl_title || "DailyMed SPL";
  const setId = item.setid || item.set_id || "";
  return {
    id: `dailymed:${setId || slugify(title)}`,
    source: "dailymed",
    sourceLabel: "DailyMed",
    title,
    api: "",
    formulation: "",
    manufacturer: item.published_date ? `Published: ${item.published_date}` : "",
    setId,
    url: setId
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`
      : "https://dailymed.nlm.nih.gov/",
    sections: [],
    englishText: title,
    needsFullLabel: Boolean(setId),
    hydrated: false,
  };
}

async function searchDailyMedSource(query, { limit = 8, filters = {} } = {}) {
  const f = normalizeSmpcFilters(filters);
  const q = String(query || "").trim();
  if (!q && !hasActiveSmpcFilters(f)) return [];
  if (hasActiveSmpcFilters(f)) {
    const filtered = await searchByNdcFilters(q || f.atc || f.formulation || f.manufacturer, {
      limit,
      source: "dailymed",
      filters: f,
    });
    if (filtered.length) return filtered;
  }

  // OpenFDA has CORS *. DailyMed JSON often does not — use OpenFDA first.
  const seen = new Set();
  const results = [];

  for (const expr of buildQueryVariants(q)) {
    if (results.length >= limit) break;
    try {
      const batch = await fetchOpenFda(expr, Math.min(6, limit));
      for (const item of batch) {
        const setId = item.set_id || item.id;
        if (!setId || seen.has(setId)) continue;
        seen.add(setId);
        const doc = normalizeOpenFda(item);
        if (!matchesClientFilters(doc, f)) continue;
        results.push({
          ...doc,
          needsFullLabel: true,
          hydrated: false,
        });
        if (results.length >= limit) break;
      }
    } catch {
      /* try next */
    }
  }

  if (results.length >= limit) return results.slice(0, limit);

  try {
    const { text } = await fetchRemotePage(
      `${DAILYMED_SPLS}?drug_name=${encodeURIComponent(q)}&pagesize=${Math.max(limit * 2, 10)}`
    );
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      for (const item of data.data || []) {
        const doc = normalizeDailyMedListing(item);
        if (!doc.setId || seen.has(doc.setId)) continue;
        if (!matchesClientFilters(doc, f)) continue;
        seen.add(doc.setId);
        results.push(doc);
        if (results.length >= limit) break;
      }
    }
  } catch {
    /* ignore */
  }

  return results.slice(0, limit);
}

function parseEmcSearch(markdownOrHtml, { limit = 8 } = {}) {
  const text = String(markdownOrHtml || "");
  const found = [];
  const seen = new Set();

  const patterns = [
    /\[([^\]]+?)\]\((https?:\/\/(?:www\.)?medicines\.org\.uk\/emc\/product\/(\d+)(?:\/smpc)?)\)/gi,
    /href="(https?:\/\/(?:www\.)?medicines\.org\.uk\/emc\/product\/(\d+)(?:\/smpc)?)"[^>]*>\s*([^<]{3,160})/gi,
    /https?:\/\/(?:www\.)?medicines\.org\.uk\/emc\/product\/(\d+)(?:\/smpc)?/gi,
    /\/emc\/product\/(\d+)(?:\/smpc)?/gi,
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      let productId;
      let title;
      let url;
      if (match.length === 4 && match[0].startsWith("[")) {
        title = match[1].trim();
        url = match[2];
        productId = match[3];
      } else if (match.length >= 4 && match[1]?.includes("medicines.org.uk")) {
        url = match[1];
        productId = match[2];
        title = stripTags(match[3] || "").trim();
      } else {
        productId = match[1];
        url = `https://www.medicines.org.uk/emc/product/${productId}/smpc`;
        title = "";
      }
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);
      if (!title || /smpc|pil|patient|leaflet|click here/i.test(title)) {
        title = `eMC product ${productId}`;
      }
      url = `https://www.medicines.org.uk/emc/product/${productId}/smpc`;
      found.push({
        id: `emc:${productId}`,
        source: "emc",
        sourceLabel: "eMC (medicines.org.uk)",
        title,
        api: "",
        formulation: "UK SmPC",
        manufacturer: "",
        productId,
        url,
        sections: [],
        englishText: title,
        needsFullLabel: true,
        hydrated: false,
      });
      if (found.length >= limit) return found;
    }
  }
  return found;
}

function decodeMaybeUriComponent(value) {
  let out = String(value || "").replace(/\+/g, " ");
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function parseEmcHitsFromHtml(html, { limit = 8 } = {}) {
  const text = String(html || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/");
  const found = [];
  const seen = new Set();

  const pushHit = (productId, titleHint = "") => {
    if (!productId || seen.has(productId)) return;
    let title = stripTags(titleHint || "")
      .replace(/^\d+\.\s*/, "")
      .replace(/\s+/g, " ")
      .replace(/https?:\/\/\S+/g, "")
      .trim();
    if (!title || title.length < 3 || /medicines\.org|duckduckgo|smpc only|^product$/i.test(title)) {
      title = `eMC product ${productId}`;
    }
    seen.add(productId);
    found.push({
      id: `emc:${productId}`,
      source: "emc",
      sourceLabel: "eMC (medicines.org.uk)",
      title: title.slice(0, 180),
      api: "",
      formulation: "UK SmPC",
      manufacturer: "",
      productId,
      url: `https://www.medicines.org.uk/emc/product/${productId}/smpc`,
      sections: [],
      englishText: title,
      needsFullLabel: true,
      hydrated: false,
    });
  };

  // Markdown / HTML: [Title](...uddg=...product/123...) — common in Jina reader output.
  const mdUddgRe =
    /\[([^\]]{3,200})\]\((?:https?:\/\/(?:duckduckgo\.com|lite\.duckduckgo\.com)[^)]*?uddg=([^)&\s]+)[^)]*)\)/gi;
  let match;
  while ((match = mdUddgRe.exec(text))) {
    try {
      const decoded = decodeMaybeUriComponent(match[2]);
      const idMatch = decoded.match(/medicines\.org\.uk\/emc\/product\/(\d+)/i);
      if (idMatch) pushHit(idMatch[1], match[1]);
    } catch {
      /* ignore */
    }
    if (found.length >= limit) return found;
  }

  // DuckDuckGo redirect links: .../l/?uddg=https%3A%2F%2Fwww.medicines.org.uk%2Femc%2Fproduct%2F123...
  const uddgRe = /uddg=([^&"'<>\s]+)/gi;
  while ((match = uddgRe.exec(text))) {
    try {
      const decoded = decodeMaybeUriComponent(match[1]);
      const idMatch = decoded.match(/medicines\.org\.uk\/emc\/product\/(\d+)/i);
      if (idMatch) pushHit(idMatch[1]);
    } catch {
      /* ignore bad encoding */
    }
    if (found.length >= limit) return found;
  }

  // Prefer anchors that wrap product links (DuckDuckGo / eMC search HTML).
  const anchorRe =
    /<a\b[^>]*href=["']([^"']*medicines\.org\.uk\/emc\/product\/(\d+)(?:\/smpc)?)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorRe.exec(text))) {
    pushHit(match[2], match[3] || "");
    if (found.length >= limit) return found;
  }

  // Bare host without scheme (Jina often prints www.medicines.org.uk/emc/product/123/smpc).
  const bareRe = /(?:https?:\/\/)?(?:www\.)?medicines\.org\.uk\/emc\/product\/(\d+)/gi;
  while ((match = bareRe.exec(text))) {
    pushHit(match[1]);
    if (found.length >= limit) return found;
  }

  // Plain URL / markdown leftovers.
  for (const doc of parseEmcSearch(text, { limit })) {
    pushHit(doc.productId, doc.title);
    if (found.length >= limit) break;
  }
  return found;
}

async function fetchViaPuterText(url, timeoutMs = 16000) {
  return acceptRemoteText(await fetchViaPuter(url, { timeoutMs }));
}

/**
 * Fetch discovery pages for eMC.
 * Puter → DuckDuckGo HTML often returns a bot/empty page with no product ids.
 * Puter → Jina → DuckDuckGo reliably returns markdown with uddg= product links.
 */
async function fetchEmcDiscoveryPayload(targetUrl, { timeoutMs = 16000 } = {}) {
  const errors = [];
  const jinaVariants = buildJinaTargets(targetUrl).slice(0, 2);
  const budget = Math.min(timeoutMs, 16000);

  const tryAllorigins = async () => {
    const raw = await fetchWithTimeout(
      `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
      { timeoutMs: Math.min(budget, 12000) }
    );
    if (/^\s*</.test(raw)) throw new Error("allorigins html error");
    const data = JSON.parse(raw);
    return acceptRemoteText(String(data?.contents || ""));
  };

  // Race Puter→Jina with browser allorigins — whichever returns parseable content first wins.
  // Puter→DDG HTML alone often lacks product ids (bot/empty page).
  const racers = [];
  for (const variant of jinaVariants) {
    racers.push(
      fetchViaPuterText(jinaReaderUrl(variant), budget).then((text) => ({
        text,
        via: "puter-jina-ddg",
      }))
    );
  }
  racers.push(tryAllorigins().then((text) => ({ text, via: "allorigins-ddg" })));

  try {
    return await Promise.any(racers);
  } catch (aggregate) {
    const reasons = aggregate?.errors?.map((e) => e?.message || e) || [];
    errors.push(...reasons.slice(0, 4));
  }

  try {
    const text = await fetchViaPuterText(targetUrl, Math.min(budget, 12000));
    return { text, via: "puter-ddg" };
  } catch (error) {
    errors.push(`puter:${error?.message || error}`);
  }

  for (const variant of jinaVariants) {
    try {
      const text = acceptRemoteText(
        await fetchWithTimeout(jinaReaderUrl(variant), { timeoutMs: Math.min(budget, 10000) })
      );
      return { text, via: "jina-ddg" };
    } catch (error) {
      errors.push(`jina:${error?.message || error}`);
    }
  }

  throw new Error(errors.slice(0, 3).join(" · ") || "discovery fetch failed");
}

/** MHRA Products Azure Search — browser-callable (CORS *), no medicines.org.uk. */
function buildMhraSearchUrl(query, { limit = 8, skip = 0, filters = {} } = {}) {
  const f = normalizeSmpcFilters(filters);
  const params = new URLSearchParams({
    "api-version": MHRA_SEARCH_API_VERSION,
    "api-key": MHRA_SEARCH_API_KEY,
    search: String(query || "").trim() || "*",
    $top: String(Math.min(Math.max(limit, 1), 25)),
    $skip: String(Math.max(skip, 0)),
    searchMode: "all",
    scoringProfile: "preferKeywords",
    $count: "true",
  });

  const clauses = ["doc_type eq 'Spc'"];
  if (f.manufacturer) {
    // PL holder / product text often includes manufacturer keywords.
    params.set("search", `${params.get("search")} ${f.manufacturer}`.trim());
  }
  if (f.atc) params.set("search", `${params.get("search")} ${f.atc}`.trim());
  if (f.formulation) params.set("search", `${params.get("search")} ${f.formulation}`.trim());
  if (f.strength) params.set("search", `${params.get("search")} ${f.strength}`.trim());
  params.set("$filter", clauses.join(" and "));
  return `${MHRA_SEARCH_HOST}/indexes/${MHRA_SEARCH_INDEX}/docs?${params.toString()}`;
}

function normalizeMhraSearchHit(item) {
  const pdfUrl = String(item?.metadata_storage_path || "").trim();
  const productName = String(item?.product_name || "").replace(/\s+/g, " ").trim();
  const fileTitle = String(item?.title || item?.file_name || "").replace(/\s+/g, " ").trim();
  const title =
    productName ||
    (fileTitle && !/^spc-doc_/i.test(fileTitle) ? fileTitle : "") ||
    "MHRA SmPC";
  const substances = Array.isArray(item?.substance_name)
    ? item.substance_name.join(", ")
    : String(item?.substance_name || "");
  const pl = Array.isArray(item?.pl_number) ? item.pl_number.join(", ") : String(item?.pl_number || "");
  const fileName = String(item?.file_name || "");
  const idSeed = pdfUrl.split("/").pop() || fileName || title;
  const plDisplay = pl.replace(/PL(?=\d)/gi, "PL ").replace(/\s+/g, " ").trim();
  return {
    id: `mhra:${idSeed}`,
    source: "emc",
    sourceLabel: "MHRA Products (UK SmPC)",
    title,
    api: substances,
    formulation: plDisplay ? `UK SpC · ${plDisplay}` : "UK SpC",
    manufacturer: "",
    productId: "",
    plNumber: pl,
    substanceName: substances,
    productName: productName || title,
    fileName,
    url: pdfUrl || "https://products.mhra.gov.uk/",
    pdfUrl,
    sections: [],
    englishText: title,
    needsFullLabel: true,
    hydrated: false,
  };
}

async function searchMhraAzure(query, { limit = 8, filters = {} } = {}) {
  const q = String(query || "").trim();
  const f = normalizeSmpcFilters(filters);
  if (!q && !hasActiveSmpcFilters(f)) return [];

  const url = buildMhraSearchUrl(appendFilterKeywords(q || f.manufacturer || f.formulation || "*", f), {
    limit: Math.max(limit * 2, 12),
    filters: f,
  });
  const raw = await fetchWithTimeout(url, {
    timeoutMs: 18000,
    headers: { Accept: "application/json", "api-key": MHRA_SEARCH_API_KEY },
  });
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const rows = Array.isArray(data?.value) ? data.value : [];
  const docs = rows.map(normalizeMhraSearchHit).filter((doc) => doc.pdfUrl || doc.url);
  return docs.filter((doc) => matchesClientFilters(doc, f)).slice(0, limit);
}

/** UK SmPC search — MHRA Products only (replaces medicines.org.uk / eMC). */
async function searchEmcSource(query, { limit = 8, filters = {} } = {}) {
  try {
    const hits = await searchMhraAzure(query, { limit, filters });
    if (hits.length) return hits;
    throw new Error("no MHRA SpC hits");
  } catch (error) {
    throw new Error(
      `تعذّر بحث MHRA حالياً. ${error?.message || error}`.trim()
    );
  }
}

function parseUkSpcPlainSections(markdown) {
  const text = String(markdown || "")
    .replace(/\r/g, "")
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Published Time:.*$/m, "")
    .replace(/^Number of Pages:.*$/m, "")
    .replace(/^Markdown Content:\s*/im, "")
    .replace(/^#+\s*SUMMARY OF PRODUCT CHARACTERISTICS\s*/im, "")
    .trim();

  const start = text.search(
    /(?:^|\n)\s*(?:>\s*)?#*\s*1(?:\.)?\s+NAME OF THE MEDICINAL PRODUCT\b/i
  );
  const body = start >= 0 ? text.slice(start) : text;

  // Canonical EU/UK SpC headings (order matters: longer / more specific first within a number).
  const KNOWN = [
    [1, "Name of the medicinal product", /name of the medicinal product/i],
    [2, "Qualitative and quantitative composition", /qualitative and quantitative composition/i],
    [3, "Pharmaceutical form", /pharmaceutical form/i],
    [4, "Clinical particulars", /clinical particulars/i],
    ["4.1", "Therapeutic indications", /therapeutic indications?/i],
    ["4.2", "Posology and method of administration", /posology and method of administration/i],
    ["4.3", "Contraindications", /contraindications?/i],
    ["4.4", "Special warnings and precautions for use", /special warnings and precautions for use/i],
    ["4.5", "Interaction with other medicinal products and other forms of interaction", /interaction(?:s)?(?:\s+with other medicinal products)?/i],
    ["4.6", "Fertility, pregnancy and lactation", /fertility,\s*pregnancy and lactation|pregnancy and lactation/i],
    ["4.7", "Effects on ability to drive and use machines", /effects on ability to drive|effects on ability to drive and use machines/i],
    ["4.8", "Undesirable effects", /undesirable effects/i],
    ["4.9", "Overdose", /overdose/i],
    [5, "Pharmacological properties", /pharmacological properties/i],
    ["5.1", "Pharmacodynamic properties", /pharmacodynamic properties/i],
    ["5.2", "Pharmacokinetic properties", /pharmacokinetic properties/i],
    ["5.3", "Preclinical safety data", /preclinical safety data/i],
    [6, "Pharmaceutical particulars", /pharmaceutical particulars/i],
    ["6.1", "List of excipients", /list of excipients/i],
    ["6.2", "Incompatibilities", /incompatibilities/i],
    ["6.3", "Shelf life", /shelf\s*life/i],
    ["6.4", "Special precautions for storage", /special precautions for storage/i],
    ["6.5", "Nature and contents of container", /nature and contents? of container/i],
    ["6.6", "Special precautions for disposal and other handling", /instruction for use\/handling|special precautions for disposal|special precautions for disposal and other handling/i],
    [7, "Marketing authorisation holder", /marketing authorisation holder/i],
    [8, "Marketing authorisation number(s)", /marketing authorisation numbers?/i],
    [9, "Date of first authorisation/renewal of the authorisation", /date of first authorisation/i],
    [10, "Date of revision of the text", /date of revision of the text/i],
  ];

  const hits = [];
  for (const [num, label, re] of KNOWN) {
    const numRe = String(num).replace(/\./g, "\\.");
    const headingRe = new RegExp(
      `(?:^|\\n)\\s*(?:>\\s*)?#*\\s*${numRe}\\.?\\s+[^\\n]{0,220}`,
      "i"
    );
    const match = headingRe.exec(body);
    if (!match) continue;
    const line = match[0].replace(/^(?:\n)?\s*(?:>\s*)?#*\s*/, "");
    if (!re.test(line)) continue;
    const index = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const end = index + match[0].replace(/^\n/, "").length;
    hits.push({
      index,
      end,
      title: `${num} ${label}`,
      num: String(num),
    });
  }

  // Dedupe overlapping matches — keep earliest unique section number.
  hits.sort((a, b) => a.index - b.index || a.num.length - b.num.length);
  const unique = [];
  const seenNum = new Set();
  for (const hit of hits) {
    if (seenNum.has(hit.num)) continue;
    // Skip if this match sits inside a previous section's title line only.
    if (unique.length && hit.index < unique[unique.length - 1].end) continue;
    seenNum.add(hit.num);
    unique.push(hit);
  }
  if (unique.length < 3) {
    // Fallback: generic numbered headings.
    return parseMarkdownSections(body, {
      minBody: 8,
      requireNumbered: true,
      baseUrl: "https://products.mhra.gov.uk/",
    });
  }

  const sections = [];
  for (let i = 0; i < unique.length; i += 1) {
    const from = unique[i].end;
    const to = i + 1 < unique.length ? unique[i + 1].index : body.length;
    let raw = body.slice(from, to).trim();
    // Strip leading blockquote markers left by Jina.
    raw = raw.replace(/^(?:>\s*)+/gm, "").trim();
    if (raw.length < 2 && i > 0) continue;
    sections.push(
      makeSection(unique[i].title, raw || "(See source PDF.)", sections.length, "https://products.mhra.gov.uk/")
    );
  }
  return sections.filter((section) => section.text.length >= 2 || /^\d+\.\d+/.test(section.title));
}

/** Fetch MHRA PDF bytes (Azure blob has no CORS — Puter is required in the browser). */
async function fetchMhraPdfBytes(pdfUrl, { timeoutMs = 28000 } = {}) {
  const target = String(pdfUrl || "").trim();
  if (!target) throw new Error("missing pdf url");

  const cached = mhraPdfBytesCache.get(target);
  if (cached instanceof Uint8Array && cached.length > 100) {
    return cached;
  }

  const asPdfBytes = async (response) => {
    if (!response) throw new Error("empty response");
    let buffer = null;
    if (typeof response.arrayBuffer === "function") {
      try {
        buffer = await response.arrayBuffer();
      } catch {
        buffer = null;
      }
    }
    if ((!buffer || buffer.byteLength < 100) && typeof response.blob === "function") {
      const blob = await response.blob();
      buffer = await blob.arrayBuffer();
    }
    if (!buffer || buffer.byteLength < 100) throw new Error("empty PDF body");
    const bytes = new Uint8Array(buffer);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "%PDF") throw new Error("not a PDF");
    return bytes;
  };

  const tryPuterOnce = async () => {
    const { loadPuter } = await import("./puter-auth.js");
    const puter = await loadPuter();
    if (!puter?.net?.fetch) throw new Error("puter.net unavailable");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await puter.net.fetch(target, {
        method: "GET",
        signal: ctrl.signal,
        headers: { Accept: "application/pdf,*/*" },
        redirect: "follow",
      });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || "?"}`);
      return await asPdfBytes(response);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  };

  const tryPuter = async () => {
    const run = async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await tryPuterOnce();
        } catch (error) {
          lastError = error;
          const message = String(error?.message || error || "");
          if (/CONNECTING|InvalidStateError|WebSocket|Socket errored|timeout/i.test(message) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 400));
            continue;
          }
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };
    const queued = puterFetchQueue.then(run, run);
    puterFetchQueue = queued.catch(() => {});
    return queued;
  };

  const tryDirect = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 12000));
    try {
      const response = await fetch(target, {
        method: "GET",
        signal: ctrl.signal,
        cache: "no-store",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/pdf,*/*" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await asPdfBytes(response);
    } finally {
      clearTimeout(timer);
    }
  };

  let puterError = null;
  try {
    const bytes = await tryPuter();
    mhraPdfBytesCache.set(target, bytes);
    return bytes;
  } catch (error) {
    puterError = error;
  }

  try {
    const bytes = await tryDirect();
    mhraPdfBytesCache.set(target, bytes);
    return bytes;
  } catch {
    throw puterError instanceof Error ? puterError : new Error(String(puterError || "PDF fetch failed"));
  }
}

async function hydrateMhraPdfDoc(doc) {
  const pdfUrl = String(doc.pdfUrl || doc.url || "").trim();
  if (!pdfUrl) throw new Error("missing MHRA PDF url");

  // Warm Puter before PDF fetch (Wisp/WebSocket needs a moment).
  try {
    const { loadPuter } = await import("./puter-auth.js");
    await loadPuter();
  } catch {
    /* Puter required for Azure blob CORS bypass */
  }

  const { text, via } = await fetchRemotePage(pdfUrl, { preferHtml: false, timeoutMs: 32000 });
  if (isBlockedOrMissing(text) || text.length < 400) throw new Error("empty MHRA PDF text");

  let sections = parseUkSpcPlainSections(text);
  if (sections.length < 8) {
    const generic = parseMarkdownSections(text, {
      minBody: 8,
      requireNumbered: false,
      baseUrl: pdfUrl,
    }).filter(
      (section) =>
        /^\d+(?:\.\d+)*\b/.test(section.title) ||
        /name of the medicinal|composition|pharmaceutical|clinical|indication|posology|contraindic|warning|interaction|pregnancy|undesirable|overdose|pharmacolog|excipient|shelf|storage|packag|nature and contents|marketing authorisation/i.test(
          section.title
        )
    );
    if (generic.length > sections.length) sections = generic;
  }
  if (sections.length < 3) throw new Error("no SpC sections in MHRA PDF");

  // Reuse PDF bytes already fetched for text (avoids a second Puter round-trip).
  try {
    const pdfBytes = await fetchMhraPdfBytes(pdfUrl, { timeoutMs: 28000 });
    const matrices = await extractTablesFromPdfBytes(pdfBytes);
    if (matrices.length) {
      sections = injectTablesIntoSections(sections, matrices);
    }
  } catch {
    /* Heuristic MedDRA tables from markdown still apply via enrichSectionContent */
  }

  return {
    ...doc,
    source: "emc",
    sourceLabel: "MHRA Products (UK SmPC)",
    title: doc.productName || doc.title || "MHRA SmPC",
    url: pdfUrl,
    pdfUrl,
    sections,
    englishText: sections.map((sec) => `${sec.title}\n${sec.text}`).join("\n\n"),
    hydrated: true,
    needsFullLabel: false,
    fetchVia: via,
  };
}

async function hydrateEmcFull(doc) {
  // UK source is MHRA-only now (medicines.org.uk dropped).
  try {
    const { loadPuter } = await import("./puter-auth.js");
    await loadPuter();
  } catch {
    /* Puter helps PDF→text via Jina; Azure search itself does not need it */
  }

  // If this is already an MHRA hit (has pdf blob URL), hydrate it directly.
  if (/blob\.core\.windows\.net\/docs\//i.test(String(doc.pdfUrl || doc.url || ""))) {
    return hydrateMhraPdfDoc(doc);
  }

  // Legacy eMC stubs / title-only docs: search MHRA by name, then hydrate best SpC PDF.
  const hints = expandUkDrugHints(doc.title)
    .concat(expandUkDrugHints(doc.api))
    .concat(expandUkDrugHints(doc.productName))
    .filter((value, index, arr) => value && arr.indexOf(value) === index)
    .slice(0, 5);

  let lastError = null;
  for (const hint of hints) {
    try {
      const hits = await searchMhraAzure(hint, { limit: 5 });
      for (const hit of hits) {
        try {
          return await hydrateMhraPdfDoc({
            ...doc,
            ...hit,
            title: doc.title || hit.title,
          });
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `تعذّر تحميل SmPC من MHRA. ${lastError?.message || ""}`.trim()
  );
}

async function searchDrugsComSource(query, { limit = 8, filters = {} } = {}) {
  const f = normalizeSmpcFilters(filters);
  const q = String(query || "").trim();
  if (!q && !hasActiveSmpcFilters(f)) return [];
  if (hasActiveSmpcFilters(f)) {
    const filtered = await searchByNdcFilters(q || f.atc || f.formulation || f.manufacturer, {
      limit,
      source: "drugs",
      filters: f,
    });
    if (filtered.length) return filtered;
  }

  const candidates = new Map();

  const addCandidate = (name, hint = "", setId = "") => {
    const slug = slugify(name);
    if (!slug || slug.length < 3) return;
    if (candidates.has(slug)) {
      const existing = candidates.get(slug);
      if (!existing.setId && setId) existing.setId = setId;
      return;
    }
    candidates.set(slug, {
      id: `drugs:${slug}`,
      source: "drugs",
      sourceLabel: "drugs.com",
      title: name,
      api: hint || name,
      formulation: "US Package Insert",
      manufacturer: "",
      slug,
      setId: setId || "",
      url: `https://www.drugs.com/pro/${slug}.html`,
      sections: [],
      englishText: name,
      needsFullLabel: true,
      hydrated: false,
    });
  };

  addCandidate(q);
  q.split(/[\/,|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => addCandidate(part));

  for (const expr of buildQueryVariants(q)) {
    try {
      const batch = await fetchOpenFda(expr, Math.min(limit, 6));
      for (const item of batch) {
        const fda = item.openfda || {};
        const setId = item.set_id || "";
        for (const brand of fda.brand_name || []) addCandidate(brand, joinList(fda.generic_name), setId);
        for (const generic of fda.generic_name || []) {
          addCandidate(String(generic).split(",")[0], generic, setId);
        }
        for (const substance of fda.substance_name || []) addCandidate(substance, "", setId);
      }
    } catch {
      /* continue */
    }
    if (candidates.size >= limit * 2) break;
  }

  const ordered = [...candidates.values()]
    .filter((doc) => matchesClientFilters(doc, f))
    .sort((a, b) => {
      const exactA = a.slug === slugify(q) ? 0 : 1;
      const exactB = b.slug === slugify(q) ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      const setA = a.setId ? 0 : 1;
      const setB = b.setId ? 0 : 1;
      if (setA !== setB) return setA - setB;
      const junkA = /care-one|topcare|leader|good-sense|equaline|kirkland|up-and-up|infant/i.test(a.slug)
        ? 1
        : 0;
      const junkB = /care-one|topcare|leader|good-sense|equaline|kirkland|up-and-up|infant/i.test(b.slug)
        ? 1
        : 0;
      if (junkA !== junkB) return junkA - junkB;
      return a.slug.length - b.slug.length;
    });
  return ordered.slice(0, limit);
}

export async function searchSmpc(query, { limit = 8, source = "dailymed", filters = {} } = {}) {
  const q = String(query || "").trim();
  const f = normalizeSmpcFilters(filters);
  const src = SMPC_SOURCE_OPTIONS.some((item) => item.id === source) ? source : "dailymed";
  if (!q && !hasActiveSmpcFilters(f)) return [];

  // Warm Puter so MHRA PDF hydration does not pay script-load latency.
  if (src === "emc" || src === "all") {
    import("./puter-auth.js")
      .then((mod) => mod.loadPuter?.())
      .catch(() => {});
  }

  if (src === "all") {
    const perSource = Math.max(3, Math.ceil(limit / 2));
    const tasks = [
      searchDailyMedSource(q, { limit: perSource, filters: f }).catch(() => []),
      searchDrugsComSource(q, { limit: perSource, filters: f }).catch(() => []),
      searchEmcSource(q, { limit: perSource, filters: f }).catch(() => []),
    ];
    const batches = await Promise.all(tasks);
    const seen = new Set();
    const merged = [];
    const maxLen = Math.max(...batches.map((batch) => batch.length), 0);
    for (let i = 0; i < maxLen; i += 1) {
      for (const batch of batches) {
        const item = batch[i];
        if (!item) continue;
        const key = `${item.source}:${item.setId || item.plNumber || item.productId || item.slug || item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= limit) return merged;
      }
    }
    if (!merged.length) {
      throw new Error("لا نتائج من أي مصدر. جرّب اسماً إنجليزياً أو خفّف الفلاتر.");
    }
    return merged;
  }

  if ((src === "dailymed" || src === "drugs") && hasActiveSmpcFilters(f)) {
    const filtered = await searchByNdcFilters(q || f.atc || f.formulation || f.manufacturer, {
      limit,
      source: src,
      filters: f,
    });
    if (filtered.length) return filtered;
  }

  if (src === "emc") return searchEmcSource(q, { limit, filters: f });
  if (src === "drugs") return searchDrugsComSource(q, { limit, filters: f });
  return searchDailyMedSource(q, { limit, filters: f });
}

async function hydrateDrugsComFull(doc) {
  // drugs.com blocks automated fetch (403). Use FDA/DailyMed full label as the
  // equivalent US package insert, while keeping the drugs.com deep link.
  const queryHints = [
    doc.slug?.replace(/-/g, " "),
    doc.title,
    doc.api,
    String(doc.api || "").split(",")[0],
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  let setId = doc.setId || "";
  let openFdaDoc = null;

  if (setId) {
    try {
      const results = await fetchOpenFda(`set_id:"${setId}"`, 1);
      if (results.length) openFdaDoc = normalizeOpenFda(results[0]);
    } catch {
      /* continue */
    }
  }

  if (!openFdaDoc) {
    for (const hint of queryHints) {
      for (const expr of buildQueryVariants(hint).slice(0, 3)) {
        try {
          const batch = await fetchOpenFda(expr, 3);
          if (!batch.length) continue;
          openFdaDoc = normalizeOpenFda(batch[0]);
          setId = openFdaDoc.setId || setId;
          break;
        } catch {
          /* next */
        }
      }
      if (openFdaDoc) break;
    }
  }

  if (setId || openFdaDoc?.setId) {
    const base = {
      ...(openFdaDoc || doc),
      id: doc.id,
      source: "drugs",
      setId: setId || openFdaDoc?.setId,
      title: doc.title || openFdaDoc?.title,
      url: doc.url,
      needsFullLabel: true,
      hydrated: false,
    };
    const full = await hydrateDailyMedFull(base);
    if (full?.sections?.length >= 3) {
      return {
        ...full,
        id: doc.id,
        source: "drugs",
        sourceLabel: "drugs.com ≈ FDA/DailyMed Package Insert",
        title: doc.title || full.title,
        url: doc.url,
        drugsComUrl: doc.url,
        setId: full.setId || setId,
        hydrated: true,
        needsFullLabel: false,
      };
    }
  }

  throw new Error(
    "drugs.com يمنع الجلب الآلي. افتح الرابط يدوياً أو استخدم مصدر DailyMed لنفس الدواء."
  );
}

export async function hydrateSmpcDocument(doc, { onStatus } = {}) {
  if (!doc) return doc;
  if (doc.hydrated && doc.sections?.length >= 8 && !doc.needsFullLabel) return doc;

  if (doc.source === "emc") {
    onStatus?.("جارٍ تحميل SmPC الكامل من MHRA…");
    return hydrateEmcFull(doc);
  }
  if (doc.source === "drugs") {
    onStatus?.("جارٍ تحميل النشرة الكاملة من drugs.com…");
    return hydrateDrugsComFull(doc);
  }

  onStatus?.("جارٍ تحميل نشرة DailyMed الكاملة…");
  return hydrateDailyMedFull(doc);
}

/** @deprecated use hydrateSmpcDocument */
export async function hydrateDailyMedLabel(doc) {
  return hydrateSmpcDocument(doc);
}

export function renderSmpcSearchResults(docs) {
  if (!docs.length) {
    return `<p class="muted search-empty">لا توجد نتائج SmPC لهذا المصدر. جرّب اسماً آخر أو غيّر المصدر (DailyMed / MHRA / drugs.com).</p>`;
  }

  return `
    <div class="smpc-results-grid">
      ${docs
        .map(
          (doc, index) => `
        <article class="smpc-result-card" data-id="${escapeHtml(doc.id)}" data-source="${escapeHtml(doc.source)}">
          <div class="smpc-result-head">
            <span class="smpc-rank">#${index + 1}</span>
            <span class="smpc-source-chip">${escapeHtml(doc.sourceLabel)}</span>
          </div>
          <h3 class="smpc-result-title">${escapeHtml(doc.title)}</h3>
          <p class="muted smpc-result-meta">
            ${doc.api ? `API: ${escapeHtml(doc.api)}` : ""}
            ${doc.formulation ? ` · ${escapeHtml(doc.formulation)}` : ""}
            ${doc.manufacturer ? ` · ${escapeHtml(doc.manufacturer)}` : ""}
            ${doc.packagingSummary ? ` · Pack: ${escapeHtml(doc.packagingSummary)}` : ""}
            ${doc.pharmClass ? ` · Class: ${escapeHtml(String(doc.pharmClass).slice(0, 90))}` : ""}
            ${doc.productType ? ` · ${escapeHtml(doc.productType)}` : ""}
          </p>
          <div class="smpc-ext-links">
            <a class="btn ghost small" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">فتح المصدر</a>
          </div>
          <button type="button" class="btn primary small smpc-open-btn" data-id="${escapeHtml(doc.id)}">عرض SmPC</button>
        </article>`
        )
        .join("")}
    </div>`;
}

export function renderSmpcDocument(doc, { arabicSections = null } = {}) {
  if (!doc) return "";
  const sections = arabicSections || doc.sections || [];
  const isArabic = Boolean(arabicSections);

  const renderBody = (section) => {
    const html = String(section.html || "").trim();
    if (html && /<(?:table|img|p|ul|ol|br|div|strong|em)\b/i.test(html)) {
      return `<div class="smpc-section-body smpc-section-rich">${sanitizeRichHtml(html)}</div>`;
    }
    const text = String(section.text || "");
    if (/<(?:table|img)\b/i.test(text)) {
      const rich = enrichSectionContent(text, DAILYMED_BASE);
      if (rich.html) {
        return `<div class="smpc-section-body smpc-section-rich">${sanitizeRichHtml(rich.html)}</div>`;
      }
    }
    return `<div class="smpc-section-body">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  };

  return `
    <article class="smpc-document ${isArabic ? "smpc-document-ar" : "smpc-document-en"}" data-id="${escapeHtml(doc.id)}" dir="${isArabic ? "rtl" : "ltr"}" lang="${isArabic ? "ar" : "en"}">
      <header class="smpc-document-header">
        <h3>${escapeHtml(isArabic ? "نشرة خصائص المنتج (ترجمة عربية)" : "Summary of Product Characteristics")}</h3>
        <p class="muted">${escapeHtml(doc.title)}</p>
        <p class="muted smpc-document-source" dir="${isArabic ? "rtl" : "ltr"}">
          المصدر: ${escapeHtml(doc.sourceLabel)}
          ${doc.url ? ` · <a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">الصفحة الأصلية</a>` : ""}
          ${sections.length ? ` · ${sections.length} قسماً` : ""}
        </p>
      </header>
      <div class="smpc-sections">
        ${
          sections.length
            ? sections
                .map(
                  (section) => `
          <section class="smpc-section" id="smpc-${escapeHtml(section.key)}">
            <h4>${escapeHtml(section.title)}</h4>
            ${renderBody(section)}
          </section>`
                )
                .join("")
            : `<p class="muted">لا يوجد محتوى بعد.</p>`
        }
      </div>
    </article>`;
}

export function bindSmpcSearchResults(root, { onOpen } = {}) {
  root?.querySelectorAll(".smpc-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => onOpen?.(btn.dataset.id));
  });
}

export function documentToPlainText(doc, sections = doc?.sections) {
  const lines = [
    "Summary of Product Characteristics",
    doc?.title || "",
    doc?.api ? `API: ${doc.api}` : "",
    doc?.formulation ? `Formulation: ${doc.formulation}` : "",
    doc?.sourceLabel ? `Source: ${doc.sourceLabel}` : "",
    "",
  ];
  for (const section of sections || []) {
    lines.push(section.title, section.text, "");
  }
  return lines.filter((line) => line !== undefined).join("\n");
}
