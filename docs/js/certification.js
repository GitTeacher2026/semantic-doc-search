/**
 * Certification search across common certification bodies' public directories.
 * Live JSON/HTML fetch where public endpoints exist (via Puter CORS-free
 * networking + proxy fallbacks). Supports in-app certificate view/download.
 */

const JINA_PREFIX = "https://r.jina.ai/";
const ALLORIGINS_RAW = "https://api.allorigins.win/raw?url=";
const PROXY_PREF_KEY = "cert_proxy_pref_v3";
const INTERTEK_API =
  "https://sustainabilitydirectory-api-dmbzh6feegf0fqcc.eastus-01.azurewebsites.net";

export const ISO_STANDARDS = [
  { id: "9001", label: "ISO 9001 (Quality)" },
  { id: "14001", label: "ISO 14001 (Environment)" },
  { id: "45001", label: "ISO 45001 (OH&S)" },
  { id: "27001", label: "ISO 27001 (Information security)" },
  { id: "22000", label: "ISO 22000 (Food safety)" },
  { id: "13485", label: "ISO 13485 (Medical devices)" },
  { id: "50001", label: "ISO 50001 (Energy)" },
  { id: "37001", label: "ISO 37001 (Anti-bribery)" },
  { id: "22301", label: "ISO 22301 (Business continuity)" },
];

export const CERT_BODIES = [
  {
    id: "sgs",
    label: "SGS",
    region: "Global",
    hint: "Product / scheme certificates (live)",
    portal: "https://www.sgs.com/en/certified-clients-and-products/certified-client-directory",
    searchPortal: ({ company, certNumber }) => {
      const base = "https://procertportal.sgs.com/SearchCertificates/";
      const q = certNumber || company;
      return q ? `${base}?q=${encodeURIComponent(q)}` : base;
    },
    live: "sgs",
  },
  {
    id: "tuvrheinland",
    label: "TÜV Rheinland",
    region: "Global / DE",
    hint: "Certipedia — ISO & product certificates (live)",
    portal: "https://www.certipedia.com/",
    searchPortal: ({ company, certNumber }) =>
      `https://www.certipedia.com/search?q=${encodeURIComponent(certNumber || company || "")}&locale=en`,
    live: "tuvrheinland",
  },
  {
    id: "bv",
    label: "Bureau Veritas",
    region: "Global / FR",
    hint: "Certified clients register — ISO MS (live)",
    portal: "https://certifie.bureauveritas.fr/recherche.php?certificat=certifies",
    searchPortal: ({ company }) =>
      `https://certifie.bureauveritas.fr/recherche.php?certificat=certifies&q=${encodeURIComponent(company || "")}`,
    live: "bv",
  },
  {
    id: "intertek",
    label: "Intertek",
    region: "Global",
    hint: "Sustainability directory + PDF certificates (live)",
    portal: "https://sustainabilitydirectory.intertek.com/",
    searchPortal: ({ company, certNumber }) =>
      `https://sustainabilitydirectory.intertek.com/?q=${encodeURIComponent(certNumber || company || "")}`,
    live: "intertek",
  },
  {
    id: "bsi",
    label: "BSI",
    region: "Global / UK",
    hint: "Client directory (live when reachable)",
    portal: "https://www.bsigroup.com/en-GB/products-and-services/client-directory-certificate/",
    searchPortal: ({ company, certNumber }) => {
      const q = encodeURIComponent(certNumber || company || "");
      return `https://www.bsigroup.com/en-GB/products-and-services/client-directory-results/?q=${q}`;
    },
    live: "bsi",
  },
  {
    id: "tuvsud",
    label: "TÜV SÜD",
    region: "Global / DE",
    hint: "Certificate finder (live best-effort)",
    portal: "https://www.tuvsud.com/en-us/resource/certificate-finder",
    searchPortal: ({ company, certNumber }) =>
      `https://www.tuvsud.com/en-us/resource/certificate-finder?q=${encodeURIComponent(certNumber || company || "")}`,
    live: "tuvsud",
  },
  {
    id: "dnv",
    label: "DNV",
    region: "Global",
    hint: "Certificate checker (CAPTCHA-gated; portal fallback)",
    portal: "https://certificatechecker.dnv.com/",
    searchPortal: ({ company, certNumber }) =>
      `https://certificatechecker.dnv.com/?q=${encodeURIComponent(certNumber || company || "")}`,
    live: "dnv",
  },
  {
    id: "lrqa",
    label: "LRQA",
    region: "Global",
    hint: "Verification by enquiry (portal)",
    portal: "https://www.lrqa.com/en/contact-us/certificate-verification/",
    searchPortal: ({ company, certNumber }) =>
      `https://www.lrqa.com/en/contact-us/certificate-verification/?q=${encodeURIComponent(certNumber || company || "")}`,
    live: "lrqa",
  },
  {
    id: "dekra",
    label: "DEKRA",
    region: "Global / DE",
    hint: "CheckMe directory (live best-effort)",
    portal: "https://www.dekra-checkme.com/org",
    searchPortal: ({ company }) =>
      `https://www.dekra-checkme.com/org?q=${encodeURIComponent(company || "")}`,
    live: "dekra",
  },
  {
    id: "ukas",
    label: "UKAS CertCheck",
    region: "UK / Global",
    hint: "Accredited MS certificates (CAPTCHA-gated; portal fallback)",
    portal: "https://certcheck.ukas.com/",
    searchPortal: ({ company, certNumber }) => {
      const q = encodeURIComponent(certNumber || company || "");
      return `https://certcheck.ukas.com/?q=${q}`;
    },
    live: "ukas",
  },
];

/** @type {Map<string, object>} */
const resultStore = new Map();

export function getStoredCertResult(id) {
  return resultStore.get(String(id || "")) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function browserFetchText(url, { timeoutMs = 28000, method = "GET", headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: ctrl.signal,
      cache: "no-store",
      mode: "cors",
      credentials: "omit",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
    const message = String(error?.message || error || "");
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      throw new Error("Failed to fetch");
    }
    throw error instanceof Error ? error : new Error(message);
  } finally {
    clearTimeout(timer);
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

/** Serialize Puter networking so the Wisp/WebSocket finishes connecting. */
let puterFetchQueue = Promise.resolve();

async function fetchViaPuter(url, { timeoutMs = 28000, method = "GET", headers = {}, body } = {}) {
  const run = async () => {
    const { loadPuter } = await import("./puter-auth.js");
    const puter = await loadPuter();
    if (!puter?.net?.fetch) throw new Error("puter.net unavailable");

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const init = { method, signal: ctrl.signal, headers: { Accept: "*/*", ...headers } };
        if (body != null) init.body = body;
        const response = await puter.net.fetch(url, init);
        if (!response?.ok) throw new Error(`HTTP ${response?.status || "?"}`);
        return await response.text();
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || "");
        if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
        if (/CONNECTING|InvalidStateError|WebSocket|Socket errored/i.test(message) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 400));
          continue;
        }
        throw error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const queued = puterFetchQueue.then(run, run);
  // Keep the chain alive even when a fetch fails.
  puterFetchQueue = queued.catch(() => {});
  return queued;
}

/**
 * GET/POST remote text: Puter (CORS-free) → direct → Jina (GET) → allorigins (GET).
 */
async function fetchRemoteText(url, options = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("Empty URL");
  const method = String(options.method || "GET").toUpperCase();
  const timeoutMs = options.timeoutMs || 32000;
  const headers = options.headers || {};
  const body = options.body;
  const errors = [];
  const pref = preferredProxyName();

  const tryPuter = async () => {
    const text = await fetchViaPuter(target, { timeoutMs: Math.min(timeoutMs, 30000), method, headers, body });
    rememberProxy("puter");
    return text;
  };

  if (typeof document !== "undefined" && pref !== "skip-puter") {
    try {
      return await tryPuter();
    } catch (error) {
      errors.push(`puter: ${error?.message || error}`);
    }
  }

  try {
    const text = await browserFetchText(target, { timeoutMs, method, headers, body });
    rememberProxy("direct");
    return text;
  } catch (error) {
    errors.push(`direct: ${error?.message || error}`);
  }

  if (method === "GET") {
    const getAttempts = [
      {
        name: "jina",
        run: () => browserFetchText(`${JINA_PREFIX}${encodeURIComponent(target)}`, { timeoutMs }),
      },
      {
        name: "allorigins",
        run: async () => {
          const raw = await browserFetchText(
            `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
            { timeoutMs: Math.min(timeoutMs, 18000) }
          );
          const data = JSON.parse(raw);
          if (!data?.contents) throw new Error("empty");
          return String(data.contents);
        },
      },
      {
        name: "allorigins-raw",
        run: () =>
          browserFetchText(`${ALLORIGINS_RAW}${encodeURIComponent(target)}`, {
            timeoutMs: Math.min(timeoutMs, 18000),
          }),
      },
    ];
    for (const attempt of getAttempts) {
      try {
        const text = await attempt.run();
        if (text && text.length > 20) {
          rememberProxy(attempt.name);
          return text;
        }
      } catch (error) {
        errors.push(`${attempt.name}: ${error?.message || error}`);
      }
    }
  }

  // Last resort: Puter again (Node/tests skip document).
  if (typeof document === "undefined") {
    try {
      return await tryPuter();
    } catch (error) {
      errors.push(`puter: ${error?.message || error}`);
    }
  }

  throw new Error(`تعذّر الجلب (${errors.slice(0, 3).join(" · ")})`);
}

function looksLikeSgsPayload(text) {
  const sample = String(text || "");
  if (sample.length < 10) return false;
  if (/captcha|just a moment|access denied|error code:\s*5\d\d/i.test(sample.slice(0, 500)) && sample.length < 1200) {
    return false;
  }
  return /CertInfo|CompanyName|CertificateNo/.test(sample);
}

function unwrapJsonValue(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    text.startsWith("{") ||
    text.startsWith("[")
  ) {
    try {
      return unwrapJsonValue(JSON.parse(text), depth + 1);
    } catch {
      /* keep */
    }
  }
  return text;
}

function extractJsonBlob(text) {
  let body = String(text || "").trim();
  if (/^\s*\{/.test(body) && /"contents"\s*:/.test(body.slice(0, 240))) {
    try {
      const envelope = JSON.parse(body);
      if (typeof envelope?.contents === "string") body = envelope.contents;
      else if (envelope?.contents && typeof envelope.contents === "object") return envelope.contents;
    } catch {
      /* continue */
    }
  }
  const mdIdx = body.search(/Markdown Content:\s*/i);
  const region = mdIdx >= 0 ? body.slice(mdIdx).replace(/^Markdown Content:\s*/i, "").trim() : body;
  const unwrapped = unwrapJsonValue(region);
  if (unwrapped && typeof unwrapped === "object") return unwrapped;
  const start = region.indexOf("{");
  const end = region.lastIndexOf("}");
  if (start < 0 || end <= start) {
    const aStart = region.indexOf("[");
    const aEnd = region.lastIndexOf("]");
    if (aStart >= 0 && aEnd > aStart) {
      const arr = unwrapJsonValue(region.slice(aStart, aEnd + 1));
      if (Array.isArray(arr)) return arr;
    }
    return null;
  }
  const sliced = unwrapJsonValue(region.slice(start, end + 1));
  return sliced && typeof sliced === "object" ? sliced : null;
}

function standardMatchers(standards = []) {
  return standards
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => new RegExp(`ISO\\s*${id}|\\b${id}\\b`, "i"));
}

function matchesStandards(text, standards = []) {
  if (!standards.length) return true;
  return standardMatchers(standards).some((re) => re.test(String(text || "")));
}

function normalizeResult(item) {
  const result = {
    id: item.id,
    bodyId: item.bodyId,
    bodyLabel: item.bodyLabel,
    company: item.company || "",
    tradeName: item.tradeName || "",
    certificateNo: item.certificateNo || "",
    standard: item.standard || "",
    status: item.status || "",
    scope: item.scope || "",
    product: item.product || "",
    modelNo: item.modelNo || "",
    location: item.location || "",
    issueDate: item.issueDate || "",
    expiryDate: item.expiryDate || "",
    url: item.url || "",
    pdfUrl: item.pdfUrl || "",
    source: item.source || "portal",
    snippet: item.snippet || "",
    raw: item.raw || null,
  };
  resultStore.set(result.id, result);
  return result;
}

async function fetchCertRemote(url, { timeoutMs = 32000 } = {}) {
  const text = await fetchRemoteText(url, { timeoutMs, method: "GET" });
  if (!looksLikeSgsPayload(text)) throw new Error("bad SGS payload");
  return text;
}

async function searchSgsLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const companyName = String(company || "").trim();
  const certNo = String(certNumber || "").trim();
  if (!companyName && !certNo) return [];

  const payload = {
    CompanyName: companyName,
    TradeName: "",
    ModelNo: "",
    CertificateNo: certNo,
    ContractNo: "",
  };
  const buildApiUrl = () => {
    const query = `Type=2&json=${encodeURIComponent(JSON.stringify(payload))}&IP=0&_=${Date.now()}`;
    return `https://procertportal.sgs.com/SearchCertificatesAPI/api/Job/GetCertData?${query}`;
  };

  let text = "";
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      text = await fetchCertRemote(buildApiUrl(), { timeoutMs: 32000 });
      if (text && (text.includes("CertInfo") || text.includes("CompanyName"))) break;
      lastError = new Error("empty SGS payload");
      text = "";
    } catch (error) {
      lastError = error;
      text = "";
      await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 350));
    }
  }
  if (!text) throw lastError || new Error("تعذّر الاتصال بـ SGS");

  const data = extractJsonBlob(text);
  const rows = Array.isArray(data?.CertInfo) ? data.CertInfo : [];
  const out = [];
  for (const row of rows) {
    const blob = [row.CompanyName, row.CertificateNo, row.CertificationType, row.CertifiedProduct]
      .filter(Boolean)
      .join(" ");
    if (standards.length && !matchesStandards(blob, standards)) continue;
    out.push(
      normalizeResult({
        id: `sgs:${row.CertID || row.CertificateNo || out.length}`,
        bodyId: "sgs",
        bodyLabel: "SGS",
        company: row.CompanyName || companyName,
        tradeName: row.TradeName && row.TradeName !== "-" ? row.TradeName : "",
        certificateNo: row.CertificateNo || "",
        standard: row.CertificationType || "",
        status: row.CertificateStatus || "",
        product: row.CertifiedProduct || "",
        modelNo: row.ModelNo || "",
        url: "https://procertportal.sgs.com/SearchCertificates/",
        source: "live",
        snippet: [row.CertifiedProduct, row.ModelNo, row.CertificationType].filter(Boolean).join(" · "),
        raw: row,
      })
    );
    if (out.length >= limit) break;
  }
  return out;
}

function flattenCertipedia(payload) {
  if (Array.isArray(payload) && Array.isArray(payload[0])) return payload[0];
  if (Array.isArray(payload)) return payload;
  return [];
}

async function searchCertipediaLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const q = String(certNumber || company || "").trim();
  if (!q) return [];
  const endpoints = [
    `https://www.certipedia.com/search/matching_system_certificates?q=${encodeURIComponent(q)}&locale=en`,
    `https://www.certipedia.com/search/matching_product_certificates?q=${encodeURIComponent(q)}&locale=en`,
  ];
  const rows = [];
  for (const url of endpoints) {
    try {
      const text = await fetchRemoteText(url, {
        timeoutMs: 28000,
        headers: { Accept: "application/json" },
      });
      const parsed = extractJsonBlob(text) || JSON.parse(text);
      rows.push(...flattenCertipedia(parsed));
    } catch {
      /* try next */
    }
  }
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const holder = row.certificate_holder || {};
    const companyName = [holder.name, holder.name2].filter(Boolean).join(" ") || company;
    const certNo = row.formatted_certificate_number || row.certificate_number || "";
    const standard = row.certificate_type_name || (row.standards || []).join(", ") || "";
    const blob = [companyName, certNo, standard, row.scope, row.full_product].filter(Boolean).join(" ");
    if (standards.length && !matchesStandards(blob, standards)) continue;
    const id = `tuvrheinland:${certNo || out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const detailUrl = certNo
      ? `https://www.certipedia.com/certificates/${encodeURIComponent(String(certNo).replace(/ /g, "+"))}?locale=en`
      : `https://www.certipedia.com/search?q=${encodeURIComponent(q)}&locale=en`;
    out.push(
      normalizeResult({
        id,
        bodyId: "tuvrheinland",
        bodyLabel: "TÜV Rheinland",
        company: companyName,
        certificateNo: certNo,
        standard,
        status: row.has_single_public_pdf_document ? "Public PDF available" : "Listed",
        scope: stripTags(row.scope || row.qm_scope || ""),
        product: row.full_product || row.model_designation || "",
        location: [holder.city, holder.country].filter(Boolean).join(", "),
        issueDate: row.issue_date || "",
        url: detailUrl,
        source: "live",
        snippet: [standard, stripTags(row.scope || "").slice(0, 140)].filter(Boolean).join(" · "),
        raw: row,
      })
    );
    if (out.length >= limit) break;
  }
  return out;
}

async function searchBureauVeritasLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const name = String(company || "").trim();
  const cert = String(certNumber || "").trim();
  if (!name && !cert) return [];

  const body = new URLSearchParams({
    referentiel_search: "certifies",
    recherche_raison_sociale: name,
    recherche_numero_affaire: cert,
  }).toString();

  const text = await fetchRemoteText("https://certifie.bureauveritas.fr/resultats.php", {
    method: "POST",
    timeoutMs: 30000,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
    body,
  });

  const parts = String(text).split(/<div class="bloc-resultat certifies[^"]*"/i);
  const out = [];
  for (const part of parts.slice(1)) {
    const companyLine = stripTags((part.match(/<h3>([\s\S]*?)<\/h3>/i) || [])[1] || "");
    const paragraphs = [...part.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((match) => stripTags(match[1]));
    if (!companyLine && !paragraphs.length) continue;

    const affairLine = paragraphs.find((line) => /Numéro d'affaire/i.test(line)) || "";
    const certLine = paragraphs.find((line) => /Certifié/i.test(line)) || "";
    const statusLine = paragraphs.find((line) => /Statut/i.test(line)) || "";
    const location =
      paragraphs.find((line) => /^\d{4,5}\s+/.test(line)) ||
      paragraphs.find((line) => !/Numéro|Certifié|Statut/i.test(line) && line.length > 3) ||
      "";

    const affair = (affairLine.match(/(\d{5,})/) || [])[1] || "";
    const certMatch =
      certLine.match(/Certifié\s+(.+?)\s+N[°ºo]\s*([A-Z0-9/-]+)/i) ||
      certLine.match(/Certifié\s+(.+)/i);
    const standard = (certMatch?.[1] || "").trim();
    const certificateNo = (certMatch?.[2] || cert || "").trim();
    const status = statusLine.replace(/^Statut\s+/i, "").trim() || "Certifié";
    const blob = [companyLine, standard, certificateNo].join(" ");
    if (standards.length && !matchesStandards(blob, standards)) continue;

    out.push(
      normalizeResult({
        id: `bv:${certificateNo || affair || out.length}:${companyLine}`,
        bodyId: "bv",
        bodyLabel: "Bureau Veritas",
        company: companyLine || name,
        certificateNo: certificateNo || (affair ? `Affaire ${affair}` : ""),
        standard,
        status,
        location,
        url: "https://certifie.bureauveritas.fr/recherche.php?certificat=certifies",
        source: "live",
        snippet: [standard, location, affair ? `Affaire ${affair}` : ""].filter(Boolean).join(" · "),
        raw: { paragraphs, affair },
      })
    );
    if (out.length >= limit) break;
  }
  return out;
}

async function searchIntertekLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const q = String(certNumber || company || "").trim();
  if (!q) return [];
  const text = await fetchRemoteText(
    `${INTERTEK_API}/public/search-certificates?_start=0&_limit=${Math.min(limit, 25)}`,
    {
      method: "POST",
      timeoutMs: 28000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://sustainabilitydirectory.intertek.com",
      },
      body: JSON.stringify({
        Where: {
          fullText: q,
          certificate_include_accredited: true,
          certificate_include_non_accredited: true,
        },
      }),
    }
  );
  let rows = [];
  try {
    const parsed = extractJsonBlob(text) || JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("Intertek: bad JSON");
  }

  const out = [];
  for (const row of rows) {
    const cert = row.certificate || {};
    const product = Array.isArray(row.products) ? row.products[0] : null;
    const companyName = product?.brandName || product?.name || company || "Intertek listing";
    const standard = cert.conformanceCriteria || cert.title || "";
    const blob = [companyName, cert.number, standard].join(" ");
    if (standards.length && !matchesStandards(blob, standards)) continue;
    const pdfUrl = cert.certificateFileUrl
      ? `${INTERTEK_API}/images/certificates/${cert.certificateFileUrl}`
      : "";
    out.push(
      normalizeResult({
        id: `intertek:${cert.id || cert.number || out.length}`,
        bodyId: "intertek",
        bodyLabel: "Intertek",
        company: companyName,
        certificateNo: cert.number || "",
        standard,
        status: cert.activationStatus || "",
        product: product?.name || "",
        issueDate: (cert.issueDate || cert.startDate || "").slice(0, 10),
        expiryDate: (cert.expirationDate || "").slice(0, 10),
        url: "https://sustainabilitydirectory.intertek.com/",
        pdfUrl,
        source: "live",
        snippet: [standard.slice(0, 120), product?.name].filter(Boolean).join(" · "),
        raw: row,
      })
    );
    if (out.length >= limit) break;
  }
  return out;
}

function parseBsiHtml(html, { company, limit }) {
  const text = String(html || "");
  const out = [];
  // Result cards often use data attributes or repeated blocks.
  const blocks = text.split(/data-component="cdc-result"|class="cdc-result/i);
  for (const block of blocks.slice(1)) {
    const plain = stripTags(block).slice(0, 500);
    if (/no results|no-results/i.test(plain) && plain.length < 80) continue;
    const certNo = (plain.match(/\b([A-Z]{1,3}\s?\d{4,8})\b/) || [])[1] || "";
    const std = (plain.match(/ISO\s?\d{4,5}(?::\d{4})?/) || [])[0] || "";
    const companyName =
      (plain.match(/([A-Z][A-Za-z0-9 &.,'-]{3,80})/) || [])[1] || company || "";
    if (!certNo && !std && plain.length < 20) continue;
    out.push(
      normalizeResult({
        id: `bsi:${certNo || out.length}:${companyName}`,
        bodyId: "bsi",
        bodyLabel: "BSI",
        company: companyName,
        certificateNo: certNo,
        standard: std,
        status: /valid|current/i.test(plain) ? "Valid" : "Listed",
        url: `https://www.bsigroup.com/en-GB/products-and-services/client-directory-results/?q=${encodeURIComponent(
          company || certNo
        )}`,
        source: "live",
        snippet: plain.slice(0, 160),
      })
    );
    if (out.length >= limit) break;
  }
  return out;
}

async function searchBsiLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const q = String(certNumber || company || "").trim();
  if (!q) return [];
  const url = `https://www.bsigroup.com/V1CDResultsPage/GetCDResultData/?locale=en-GB&token=&q=${encodeURIComponent(q)}`;
  const text = await fetchRemoteText(url, {
    timeoutMs: 28000,
    headers: { Accept: "text/html,*/*", "User-Agent": "Mozilla/5.0" },
  });
  if (/cdc-no-results/i.test(text) && stripTags(text).length < 40) {
    throw new Error("BSI يتطلب التحقق (reCAPTCHA) — افتح الدليل الرسمي");
  }
  const out = parseBsiHtml(text, { company: q, limit }).filter((item) =>
    matchesStandards([item.standard, item.snippet].join(" "), standards)
  );
  if (!out.length) throw new Error("BSI: لا نتائج مباشرة (قد يلزم CAPTCHA)");
  return out;
}

async function searchTuvSudLive({ company, certNumber, standards = [], limit = 12 } = {}) {
  const name = String(company || "").trim();
  const cert = String(certNumber || "").trim();
  if (!name && !cert) return [];
  const body = new URLSearchParams({
    "objCertificate.CertificateNo": cert,
    "objCertificate.CompanyName": name,
  }).toString();
  const text = await fetchRemoteText(
    "https://exapps.tuvsud.com/SA/CertificateList/CertificateFinderTool",
    {
      method: "POST",
      timeoutMs: 28000,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
      body,
    }
  );
  if (/No data available/i.test(text)) return [];
  const out = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = rowRe.exec(text)) && out.length < limit) {
    const cells = match.slice(1).map(stripTags);
    if (/Certificate No/i.test(cells[0])) continue;
    const blob = cells.join(" ");
    if (standards.length && !matchesStandards(blob, standards)) continue;
    out.push(
      normalizeResult({
        id: `tuvsud:${cells[0] || out.length}`,
        bodyId: "tuvsud",
        bodyLabel: "TÜV SÜD",
        company: cells[1] || name,
        certificateNo: cells[0] || cert,
        location: cells[2] || "",
        standard: cells[3] || "",
        status: cells[4] || "",
        url: "https://www.tuvsud.com/en-us/resource/certificate-finder",
        source: "live",
        snippet: cells.filter(Boolean).join(" · "),
      })
    );
  }
  if (!out.length) throw new Error("TÜV SÜD: لا نتائج في أداة البحث العامة");
  return out;
}

async function searchDnvLive({ company, certNumber } = {}) {
  const text = await fetchRemoteText("https://api.dnv.com/certchecker/v1/certificate-search", {
    method: "POST",
    timeoutMs: 20000,
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": "26022e99217f4f6fbcaa73773ffa6a12",
    },
    body: JSON.stringify({
      certNumber: String(certNumber || ""),
      companyName: String(company || ""),
      city: "",
      country: "",
    }),
  });
  if (/missing-input-response|captcha/i.test(text)) {
    throw new Error("DNV يتطلب CAPTCHA — استخدم الدليل الرسمي");
  }
  const data = extractJsonBlob(text) || JSON.parse(text);
  const rows = data?.value || data?.results || [];
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, 12).map((row, index) =>
    normalizeResult({
      id: `dnv:${row.certificateNumber || row.certNumber || index}`,
      bodyId: "dnv",
      bodyLabel: "DNV",
      company: row.companyName || row.customerName || company,
      certificateNo: row.certificateNumber || row.certNumber || "",
      standard: row.standard || row.scheme || "",
      status: row.status || "",
      scope: row.scope || "",
      url: "https://certificatechecker.dnv.com/",
      source: "live",
      snippet: [row.standard || row.scheme, row.scope].filter(Boolean).join(" · "),
      raw: row,
    })
  );
}

async function searchLrqaLive() {
  throw new Error("LRQA لا يوفّر دليلاً عاماً قابلاً للجلب — استخدم نموذج التحقق الرسمي");
}

async function searchDekraLive({ company, certNumber, limit = 12 } = {}) {
  const q = String(certNumber || company || "").trim();
  if (!q) return [];
  // Probe common CheckMe search shapes; many require Turnstile.
  const attempts = [
    {
      url: "https://www.dekra-checkme.com/api/org/search",
      body: { query: q, searchText: q, name: q },
    },
    {
      url: "https://www.dekra-checkme.com/api/search",
      body: { q, query: q },
    },
  ];
  for (const attempt of attempts) {
    try {
      const text = await fetchRemoteText(attempt.url, {
        method: "POST",
        timeoutMs: 15000,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attempt.body),
      });
      if (/access denied|SE2001|captcha|turnstile/i.test(text)) continue;
      const data = extractJsonBlob(text) || JSON.parse(text);
      const rows = data?.items || data?.results || data?.value || (Array.isArray(data) ? data : []);
      if (!Array.isArray(rows) || !rows.length) continue;
      return rows.slice(0, limit).map((row, index) =>
        normalizeResult({
          id: `dekra:${row.id || row.certificateNumber || index}`,
          bodyId: "dekra",
          bodyLabel: "DEKRA",
          company: row.name || row.organizationName || row.companyName || company,
          certificateNo: row.certificateNumber || row.certNumber || "",
          standard: row.standard || row.scheme || "",
          status: row.status || "",
          url: "https://www.dekra-checkme.com/org",
          source: "live",
          snippet: row.scope || row.description || "",
          raw: row,
        })
      );
    } catch {
      /* next */
    }
  }
  throw new Error("DEKRA CheckMe محمي (Turnstile) — افتح الدليل الرسمي");
}

async function searchUkasLive() {
  throw new Error("UKAS CertCheck يتطلب CAPTCHA وحدّاً يومياً — افتح الدليل الرسمي");
}

const LIVE_SEARCHERS = {
  sgs: searchSgsLive,
  tuvrheinland: searchCertipediaLive,
  bv: searchBureauVeritasLive,
  intertek: searchIntertekLive,
  bsi: searchBsiLive,
  tuvsud: searchTuvSudLive,
  dnv: searchDnvLive,
  lrqa: searchLrqaLive,
  dekra: searchDekraLive,
  ukas: searchUkasLive,
};

function portalCards(bodies, { company, certNumber, standards }) {
  return bodies.map((body) => {
    const url = body.searchPortal?.({ company, certNumber, standards }) || body.portal;
    const stdLabel = standards.length
      ? standards.map((id) => `ISO ${id}`).join(", ")
      : "ISO management systems";
    return normalizeResult({
      id: `portal:${body.id}:${company || certNumber || "open"}`,
      bodyId: body.id,
      bodyLabel: body.label,
      company: company || "—",
      certificateNo: certNumber || "",
      standard: stdLabel,
      status: "Open official directory",
      url,
      source: "portal",
      snippet: `${body.hint}. افتح الدليل الرسمي للتحقق أو جلب الشهادة من موقع الهيئة.`,
    });
  });
}

export async function searchCertifications({
  company = "",
  certNumber = "",
  standards = [],
  bodyIds = [],
  limit = 20,
} = {}) {
  const qCompany = String(company || "").trim();
  const qCert = String(certNumber || "").trim();
  if (!qCompany && !qCert) {
    throw new Error("أدخل اسم الشركة أو رقم الشهادة.");
  }

  const selected = CERT_BODIES.filter((body) =>
    bodyIds.length ? bodyIds.includes(body.id) : true
  );
  if (!selected.length) {
    throw new Error("اختر هيئة تصديق واحدة على الأقل.");
  }

  resultStore.clear();
  const live = [];
  const errors = [];
  // Each body may return up to `limit` hits; we trim after merge so strong
  // sources (BV / Certipedia / SGS) are not starved by weak ones.
  const perBody = Math.min(18, Math.max(6, limit));

  // Warm Puter networking once before parallel CB lookups.
  if (typeof document !== "undefined") {
    try {
      const { loadPuter } = await import("./puter-auth.js");
      await loadPuter();
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      /* proxies still available for GET */
    }
  }

  await Promise.all(
    selected.map(async (body) => {
      const searcher = LIVE_SEARCHERS[body.live || body.id];
      if (!searcher) return;
      try {
        const rows = await searcher({
          company: qCompany,
          certNumber: qCert,
          standards,
          limit: perBody,
        });
        live.push(...rows);
      } catch (error) {
        const raw = String(error?.message || error || "");
        const friendly = /failed to fetch|timeout|تعذّر|captcha|CAPTCHA|Turnstile|puter|HTTP 400/i.test(raw)
          ? /captcha|CAPTCHA|Turnstile|reCAPTCHA|HTTP 400/i.test(raw)
            ? `${body.label} محمي بـ CAPTCHA — افتح الدليل الرسمي`
            : raw.length < 180
              ? raw
              : "الجلب المباشر غير متاح الآن — افتح الدليل الرسمي"
          : raw;
        errors.push(`${body.label}: ${friendly}`);
      }
    })
  );

  // Prefer bodies with zero live hits for portal shortcuts.
  const liveBodyIds = new Set(live.map((item) => item.bodyId));
  const portalBodies = selected.filter((body) => !liveBodyIds.has(body.id));
  const portals = portalCards(portalBodies.length ? portalBodies : [], {
    company: qCompany,
    certNumber: qCert,
    standards,
  });

  // Round-robin across bodies so one source cannot dominate the grid.
  const byBody = new Map();
  for (const item of live) {
    if (!byBody.has(item.bodyId)) byBody.set(item.bodyId, []);
    byBody.get(item.bodyId).push(item);
  }
  const diversified = [];
  let added = true;
  while (diversified.length < limit && added) {
    added = false;
    for (const rows of byBody.values()) {
      if (!rows.length || diversified.length >= limit) continue;
      diversified.push(rows.shift());
      added = true;
    }
  }

  const seen = new Set();
  const merged = [];
  for (const item of [...diversified, ...portals]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return {
    results: merged,
    liveCount: diversified.length,
    portalCount: portals.length,
    errors,
    query: { company: qCompany, certNumber: qCert, standards, bodies: selected.map((b) => b.id) },
  };
}

function certActionButtons(item) {
  const canPdf = Boolean(item.pdfUrl);
  return `
    <div class="cert-result-actions">
      <button class="btn primary small" type="button" data-cert-action="view" data-cert-id="${escapeHtml(item.id)}">عرض الشهادة</button>
      ${
        canPdf
          ? `<button class="btn ghost small" type="button" data-cert-action="download-pdf" data-cert-id="${escapeHtml(item.id)}">تنزيل PDF</button>`
          : `<button class="btn ghost small" type="button" data-cert-action="download-card" data-cert-id="${escapeHtml(item.id)}">تنزيل البطاقة</button>`
      }
      ${
        item.url
          ? `<a class="btn ghost small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">المصدر</a>`
          : ""
      }
    </div>`;
}

export function renderCertificationResults(payload) {
  const results = payload?.results || [];
  if (!results.length) {
    return `<p class="muted search-empty">لا نتائج. جرّب اسماً إنجليزياً للشركة أو رقم شهادة، أو افتح الأدلة الرسمية أدناه.</p>`;
  }

  const live = results.filter((item) => item.source === "live");
  const portals = results.filter((item) => item.source === "portal");

  const liveHtml = live.length
    ? `<div class="cert-results-grid">
        ${live
          .map(
            (item, index) => `
          <article class="cert-result-card is-live" data-cert-id="${escapeHtml(item.id)}">
            <div class="cert-result-head">
              <span class="cert-rank">#${index + 1}</span>
              <span class="cert-body-chip">${escapeHtml(item.bodyLabel)}</span>
              <span class="cert-source-chip">نتيجة مباشرة</span>
              ${item.pdfUrl ? `<span class="cert-source-chip is-pdf">PDF</span>` : ""}
            </div>
            <h3 class="cert-result-title">${escapeHtml(item.company)}</h3>
            <p class="muted cert-result-meta">
              ${item.certificateNo ? `شهادة: <strong>${escapeHtml(item.certificateNo)}</strong>` : ""}
              ${item.standard ? ` · ${escapeHtml(item.standard)}` : ""}
              ${item.status ? ` · ${escapeHtml(item.status)}` : ""}
            </p>
            ${item.snippet ? `<p class="cert-result-snippet">${escapeHtml(item.snippet)}</p>` : ""}
            ${certActionButtons(item)}
          </article>`
          )
          .join("")}
      </div>`
    : `<p class="muted">لم تُرجع الهيئات المختارة نتائج مباشرة من الواجهة البرمجية. استخدم الأدلة الرسمية أدناه — بعض الهيئات تفرض CAPTCHA على البحث العام.</p>`;

  const portalHtml = portals.length
    ? `
    <h3 class="cert-section-title">الأدلة الرسمية (احتياط / هيئات محمية)</h3>
    <p class="muted cert-section-hint">هذه الروابط تفتح صفحة التحقق العامة لكل جهة عندما لا يتوفر جلب مباشر داخل الموقع.</p>
    <div class="cert-portal-grid">
      ${portals
        .map(
          (item) => `
        <article class="cert-portal-card">
          <div class="cert-portal-head">
            <strong>${escapeHtml(item.bodyLabel)}</strong>
            <span class="muted">${escapeHtml(CERT_BODIES.find((b) => b.id === item.bodyId)?.region || "")}</span>
          </div>
          <p class="muted">${escapeHtml(item.snippet)}</p>
          <a class="btn ghost small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">بحث في ${escapeHtml(item.bodyLabel)}</a>
        </article>`
        )
        .join("")}
    </div>`
    : "";

  const errHtml = payload?.errors?.length
    ? `<p class="muted cert-errors">ملاحظات الجلب: ${escapeHtml(payload.errors.join(" · "))}</p>`
    : "";

  return `${liveHtml}${portalHtml}${errHtml}`;
}

export function buildCertificateCardHtml(item) {
  const rows = [
    ["الهيئة", item.bodyLabel],
    ["الشركة", item.company],
    ["الاسم التجاري", item.tradeName],
    ["رقم الشهادة", item.certificateNo],
    ["المعيار / النوع", item.standard],
    ["الحالة", item.status],
    ["النطاق", item.scope],
    ["المنتج", item.product],
    ["الموديل", item.modelNo],
    ["الموقع", item.location],
    ["تاريخ الإصدار", item.issueDate],
    ["تاريخ الانتهاء", item.expiryDate],
    ["المصدر", item.url],
    ["ملف PDF", item.pdfUrl],
  ].filter(([, value]) => value);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>شهادة — ${escapeHtml(item.company || item.certificateNo || "certificate")}</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; max-width: 720px; margin: 2rem auto; padding: 1.5rem; color: #142; background: #f7f4ef; }
    h1 { margin: 0 0 .35rem; font-size: 1.45rem; }
    .meta { color: #556; margin-bottom: 1.25rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: right; padding: .65rem .75rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { width: 32%; color: #456; font-weight: 600; background: #f0ebe3; }
    .stamp { margin-top: 1.25rem; font-size: .85rem; color: #678; }
  </style>
</head>
<body>
  <h1>بطاقة شهادة</h1>
  <p class="meta">${escapeHtml(item.bodyLabel)} · نتيجة مسترجعة من الدليل العام</p>
  <table>
    ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("\n")}
  </table>
  <p class="stamp">Generated by DocShelf certification search · ${new Date().toISOString()}</p>
</body>
</html>`;
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadCertificatePdf(item) {
  if (!item?.pdfUrl) throw new Error("لا يوجد ملف PDF لهذه الشهادة.");
  let blob;
  try {
    const response = await fetch(item.pdfUrl, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch {
    const text = await fetchRemoteText(item.pdfUrl, { method: "GET", timeoutMs: 45000 });
    // If puter/proxy returned binary poorly as text, try puter blob path.
    try {
      const { loadPuter } = await import("./puter-auth.js");
      const puter = await loadPuter();
      const response = await puter.net.fetch(item.pdfUrl);
      blob = await response.blob();
    } catch {
      blob = new Blob([text], { type: "application/pdf" });
    }
  }
  const name = `${item.bodyId || "cert"}-${item.certificateNo || item.id || "file"}.pdf`.replace(
    /[^\w.\-]+/g,
    "_"
  );
  triggerDownload(name, blob);
}

export function downloadCertificateCard(item) {
  const html = buildCertificateCardHtml(item);
  const name = `${item.bodyId || "cert"}-${item.certificateNo || item.id || "card"}.html`.replace(
    /[^\w.\-]+/g,
    "_"
  );
  triggerDownload(name, new Blob([html], { type: "text/html;charset=utf-8" }));
}

export function renderCertificateDetail(item) {
  if (!item) return `<p class="muted">الشهادة غير موجودة في النتائج الحالية.</p>`;
  const fields = [
    ["الهيئة", item.bodyLabel],
    ["الشركة", item.company],
    ["الاسم التجاري", item.tradeName],
    ["رقم الشهادة", item.certificateNo],
    ["المعيار / النوع", item.standard],
    ["الحالة", item.status],
    ["النطاق", item.scope],
    ["المنتج", item.product],
    ["الموديل", item.modelNo],
    ["الموقع", item.location],
    ["تاريخ الإصدار", item.issueDate],
    ["تاريخ الانتهاء", item.expiryDate],
  ].filter(([, value]) => value);

  return `
    <div class="cert-detail">
      <p class="muted cert-detail-snippet">${escapeHtml(item.snippet || "")}</p>
      <dl class="cert-detail-grid">
        ${fields
          .map(
            ([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>`
          )
          .join("")}
      </dl>
      ${
        item.pdfUrl
          ? `<iframe class="cert-pdf-frame" title="Certificate PDF" src="${escapeHtml(item.pdfUrl)}"></iframe>`
          : `<iframe class="cert-pdf-frame" title="Certificate card" srcdoc="${escapeHtml(buildCertificateCardHtml(item))}"></iframe>`
      }
    </div>`;
}

export function bindCertificationResults(root, handlers = {}) {
  if (!root) return root;
  root.querySelectorAll("[data-cert-action]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const action = button.getAttribute("data-cert-action");
      const id = button.getAttribute("data-cert-id");
      const item = getStoredCertResult(id);
      if (!item) return;
      try {
        if (action === "view") handlers.onView?.(item);
        else if (action === "download-pdf") {
          button.disabled = true;
          await downloadCertificatePdf(item);
        } else if (action === "download-card") {
          downloadCertificateCard(item);
        }
      } catch (error) {
        handlers.onError?.(error, item);
      } finally {
        button.disabled = false;
      }
    });
  });
  return root;
}
