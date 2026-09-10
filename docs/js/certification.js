/**
 * Certification search across common certification bodies' public directories.
 * Avoids IAF CertSearch free-tier limits by querying CB portals directly
 * (live API where available, official verify links otherwise).
 */

const JINA_PREFIX = "https://r.jina.ai/";
const ALLORIGINS_RAW = "https://api.allorigins.win/raw?url=";
const PROXY_PREF_KEY = "cert_proxy_pref_v2";

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
    hint: "Certified clients & product certificates",
    portal: "https://www.sgs.com/en/certified-clients-and-products/certified-client-directory",
    searchPortal: ({ company, certNumber }) => {
      const base = "https://procertportal.sgs.com/SearchCertificates/";
      const q = certNumber || company;
      return q ? `${base}?q=${encodeURIComponent(q)}` : base;
    },
    live: "sgs",
  },
  {
    id: "bsi",
    label: "BSI",
    region: "Global / UK",
    hint: "Validate BSI-issued certificates",
    portal: "https://www.bsigroup.com/en-GB/validate-bsi-issued-certificates/",
    searchPortal: ({ company, certNumber }) => {
      const q = encodeURIComponent(certNumber || company || "");
      return `https://www.bsigroup.com/en-GB/validate-bsi-issued-certificates/?q=${q}`;
    },
  },
  {
    id: "bv",
    label: "Bureau Veritas",
    region: "Global",
    hint: "Bureau Veritas Certification",
    portal: "https://certification.bureauveritas.com/",
    searchPortal: ({ company }) =>
      `https://certification.bureauveritas.com/?s=${encodeURIComponent(company || "")}`,
  },
  {
    id: "tuvsud",
    label: "TÜV SÜD",
    region: "Global / DE",
    hint: "Certificate finder & management systems",
    portal: "https://www.tuvsud.com/en-us/resource/certificate-finder",
    searchPortal: ({ company, certNumber }) =>
      `https://www.tuvsud.com/en-us/resource/certificate-finder?q=${encodeURIComponent(certNumber || company || "")}`,
  },
  {
    id: "tuvrheinland",
    label: "TÜV Rheinland",
    region: "Global / DE",
    hint: "Certipedia certificate database",
    portal: "https://www.certipedia.com/",
    searchPortal: ({ company, certNumber }) =>
      `https://www.certipedia.com/search?q=${encodeURIComponent(certNumber || company || "")}`,
  },
  {
    id: "intertek",
    label: "Intertek",
    region: "Global",
    hint: "Directory of certified clients",
    portal: "https://www.intertek.com/business-assurance/directory-of-certified-clients/",
    searchPortal: () => "https://www.intertek.com/business-assurance/directory-of-certified-clients/",
  },
  {
    id: "dnv",
    label: "DNV",
    region: "Global",
    hint: "Certificate holder search",
    portal: "https://www.dnv.com/assurance/certificates/",
    searchPortal: ({ company }) =>
      `https://www.dnv.com/assurance/certificates/?q=${encodeURIComponent(company || "")}`,
  },
  {
    id: "lrqa",
    label: "LRQA",
    region: "Global",
    hint: "Certificate search",
    portal: "https://www.lrqa.com/en/certificate-search/",
    searchPortal: ({ company, certNumber }) =>
      `https://www.lrqa.com/en/certificate-search/?q=${encodeURIComponent(certNumber || company || "")}`,
  },
  {
    id: "dekra",
    label: "DEKRA",
    region: "Global / DE",
    hint: "Certificate database",
    portal: "https://www.dekra.com/en/certificate-database/",
    searchPortal: ({ company }) =>
      `https://www.dekra.com/en/certificate-database/?q=${encodeURIComponent(company || "")}`,
  },
  {
    id: "ukas",
    label: "UKAS CertCheck",
    region: "UK / Global",
    hint: "UKAS-accredited management system certificates",
    portal: "https://certcheck.ukas.com/",
    searchPortal: ({ company, certNumber }) => {
      const q = encodeURIComponent(certNumber || company || "");
      return `https://certcheck.ukas.com/?q=${q}`;
    },
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchWithTimeout(url, { timeoutMs = 28000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
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

function looksLikeSgsPayload(text) {
  const sample = String(text || "");
  if (sample.length < 10) return false;
  if (/captcha|just a moment|access denied|error code:\s*5\d\d/i.test(sample.slice(0, 500)) && sample.length < 1200) {
    return false;
  }
  return /CertInfo|CompanyName|CertificateNo/.test(sample);
}

/**
 * Direct SGS fetch via Puter networking (bypasses browser CORS).
 * Uses the site's existing Puter token; never opens a login popup.
 */
async function fetchViaPuter(url, timeoutMs = 28000) {
  const { loadPuter } = await import("./puter-auth.js");
  const puter = await loadPuter();
  if (!puter?.net?.fetch) throw new Error("puter.net unavailable");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await puter.net.fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json,text/plain,*/*" },
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status || "?"}`);
    const text = await response.text();
    if (!looksLikeSgsPayload(text)) throw new Error("puter: bad payload");
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout ${timeoutMs}ms`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function buildSgsProxyAttempts(target, timeoutMs = 32000) {
  const shortMs = Math.min(timeoutMs, 18000);
  return [
    {
      name: "jina-enc",
      // Fully-encoded so browser URL parsers don't steal ?query from SGS.
      run: () => fetchWithTimeout(`${JINA_PREFIX}${encodeURIComponent(target)}`, { timeoutMs }),
    },
    {
      name: "jina-http-enc",
      run: () => {
        const httpTarget = target.startsWith("https://")
          ? `http://${target.slice("https://".length)}`
          : target;
        return fetchWithTimeout(`${JINA_PREFIX}${encodeURIComponent(httpTarget)}`, { timeoutMs });
      },
    },
    {
      name: "allorigins-json",
      run: async () => {
        const raw = await fetchWithTimeout(
          `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
          { timeoutMs: shortMs }
        );
        const data = JSON.parse(raw);
        if (!data?.contents) throw new Error("empty");
        return String(data.contents);
      },
    },
    {
      name: "allorigins",
      run: () =>
        fetchWithTimeout(`${ALLORIGINS_RAW}${encodeURIComponent(target)}`, { timeoutMs: shortMs }),
    },
  ];
}

/**
 * Browser-safe remote fetch for SGS (no CORS on ProCert API).
 * Order: Puter.net (direct) → Jina reader → allorigins. Serial to avoid rate limits.
 */
async function fetchCertRemote(url, { timeoutMs = 32000 } = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("Empty URL");

  const errors = [];
  const pref = preferredProxyName();

  // 1) Puter CORS-free path (best for production custom domains).
  if (typeof document !== "undefined" && pref !== "skip-puter") {
    try {
      const text = await fetchViaPuter(target, Math.min(timeoutMs, 28000));
      rememberProxy("puter");
      return text;
    } catch (error) {
      errors.push(`puter: ${error?.message || error}`);
    }
  }

  let attempts = buildSgsProxyAttempts(target, timeoutMs);
  if (pref && pref !== "puter") {
    attempts = [
      ...attempts.filter((item) => item.name.startsWith(pref)),
      ...attempts.filter((item) => !item.name.startsWith(pref)),
    ];
  } else if (pref === "puter") {
    // Puter worked before — keep jina first among fallbacks.
  }

  for (const attempt of attempts) {
    try {
      const text = await attempt.run();
      if (!looksLikeSgsPayload(text)) {
        errors.push(`${attempt.name}: bad payload`);
        continue;
      }
      rememberProxy(attempt.name.split("-")[0]);
      return text;
    } catch (error) {
      errors.push(`${attempt.name}: ${error?.message || error}`);
    }
  }

  throw new Error(`تعذّر جلب بيانات SGS (${errors.slice(0, 3).join(" · ")})`);
}

/** Unwrap nested JSON / jina markdown / allorigins envelopes into an object. */
function unwrapJsonValue(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;
  let text = value.trim();
  if (!text) return null;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    text.startsWith("{") ||
    text.startsWith("[")
  ) {
    try {
      return unwrapJsonValue(JSON.parse(text), depth + 1);
    } catch {
      /* keep scanning */
    }
  }
  return text;
}

function extractJsonBlob(text) {
  let body = String(text || "").trim();

  // allorigins /get envelope
  if (/^\s*\{/.test(body) && /"contents"\s*:/.test(body.slice(0, 240))) {
    try {
      const envelope = JSON.parse(body);
      if (typeof envelope?.contents === "string") body = envelope.contents;
      else if (envelope?.contents && typeof envelope.contents === "object") {
        return envelope.contents;
      }
    } catch {
      /* continue */
    }
  }

  const mdIdx = body.search(/Markdown Content:\s*/i);
  let region = mdIdx >= 0 ? body.slice(mdIdx).replace(/^Markdown Content:\s*/i, "").trim() : body;

  const unwrapped = unwrapJsonValue(region);
  if (unwrapped && typeof unwrapped === "object") return unwrapped;

  const start = region.indexOf("{");
  const end = region.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
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
  const blob = String(text || "");
  return standardMatchers(standards).some((re) => re.test(blob));
}

function normalizeResult(item) {
  return {
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
    url: item.url || "",
    source: item.source || "portal",
    snippet: item.snippet || "",
  };
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
      // brief pause before retry (helps with flaky reader caches)
      await new Promise((resolve) => setTimeout(resolve, 400 + attempt * 400));
    }
  }
  if (!text) {
    throw lastError || new Error("تعذّر الاتصال بـ SGS");
  }

  const data = extractJsonBlob(text);
  const rows = Array.isArray(data?.CertInfo) ? data.CertInfo : [];
  const out = [];
  for (const row of rows) {
    const blob = [
      row.CompanyName,
      row.TradeName,
      row.CertificateNo,
      row.CertificationType,
      row.CertifiedProduct,
      row.ModelNo,
      row.CertificateStatus,
    ]
      .filter(Boolean)
      .join(" ");
    if (standards.length && !matchesStandards(blob, standards)) {
      continue;
    }
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
      })
    );
    if (out.length >= limit) break;
  }

  if (!out.length && rows.length && standards.length) {
    for (const row of rows.slice(0, Math.min(limit, 8))) {
      out.push(
        normalizeResult({
          id: `sgs:${row.CertID || row.CertificateNo || out.length}`,
          bodyId: "sgs",
          bodyLabel: "SGS",
          company: row.CompanyName || companyName,
          tradeName: row.TradeName && row.TradeName !== "-" ? row.TradeName : "",
          certificateNo: row.CertificateNo || "",
          standard: row.CertificationType || "Product / scheme certificate",
          status: row.CertificateStatus || "",
          product: row.CertifiedProduct || "",
          modelNo: row.ModelNo || "",
          url: "https://procertportal.sgs.com/SearchCertificates/",
          source: "live",
          snippet:
            "SGS product/scheme certificate (not necessarily ISO management system). Verify ISO MS on the Certified Client Directory / UKAS CertCheck.",
        })
      );
    }
  }
  return out;
}

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
      snippet: `${body.hint}. Search this certification body’s public directory for accredited certificates.`,
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

  const live = [];
  const errors = [];

  await Promise.all(
    selected.map(async (body) => {
      if (body.live !== "sgs") return;
      try {
        const rows = await searchSgsLive({
          company: qCompany,
          certNumber: qCert,
          standards,
          limit: Math.min(limit, 15),
        });
        live.push(...rows);
      } catch (error) {
        const raw = String(error?.message || error || "");
        // Soft note only — portal cards still cover manual verification.
        const friendly = /failed to fetch|timeout|تعذّر|puter|jina|allorigins|HTTP /i.test(raw)
          ? "الجلب المباشر غير متاح الآن — افتح الدليل الرسمي أدناه"
          : raw;
        errors.push(`${body.label}: ${friendly}`);
      }
    })
  );

  const portals = portalCards(selected, {
    company: qCompany,
    certNumber: qCert,
    standards,
  });

  // Live hits first, then official portal shortcuts (dedupe by id).
  const seen = new Set();
  const merged = [];
  for (const item of [...live, ...portals]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= limit + selected.length) break;
  }

  return {
    results: merged,
    liveCount: live.length,
    portalCount: portals.length,
    errors,
    query: { company: qCompany, certNumber: qCert, standards, bodies: selected.map((b) => b.id) },
  };
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
          <article class="cert-result-card is-live">
            <div class="cert-result-head">
              <span class="cert-rank">#${index + 1}</span>
              <span class="cert-body-chip">${escapeHtml(item.bodyLabel)}</span>
              <span class="cert-source-chip">نتيجة مباشرة</span>
            </div>
            <h3 class="cert-result-title">${escapeHtml(item.company)}</h3>
            <p class="muted cert-result-meta">
              ${item.certificateNo ? `شهادة: <strong>${escapeHtml(item.certificateNo)}</strong>` : ""}
              ${item.standard ? ` · ${escapeHtml(item.standard)}` : ""}
              ${item.status ? ` · ${escapeHtml(item.status)}` : ""}
            </p>
            ${item.snippet ? `<p class="cert-result-snippet">${escapeHtml(item.snippet)}</p>` : ""}
            <div class="cert-result-actions">
              <a class="btn primary small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">فتح دليل ${escapeHtml(item.bodyLabel)}</a>
            </div>
          </article>`
          )
          .join("")}
      </div>`
    : `<p class="muted">لم تُرجع الهيئات المختارة نتائج مباشرة من الواجهة البرمجية. استخدم الأدلة الرسمية أدناه للتحقق من اعتماد ISO.</p>`;

  const portalHtml = `
    <h3 class="cert-section-title">الأدلة الرسمية لهيئات التصديق</h3>
    <p class="muted cert-section-hint">ابحث داخل موقع كل هيئة عن الشركة / رقم الشهادة. هذه الروابط تفتح صفحة التحقق العامة لكل جهة.</p>
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
    </div>`;

  const errHtml = payload?.errors?.length
    ? `<p class="muted cert-errors">ملاحظات الجلب: ${escapeHtml(payload.errors.join(" · "))}</p>`
    : "";

  return `${liveHtml}${portalHtml}${errHtml}`;
}

export function bindCertificationResults(root) {
  // Links are plain anchors; reserved for future detail actions.
  return root;
}
