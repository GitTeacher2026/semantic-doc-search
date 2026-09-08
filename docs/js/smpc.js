/**
 * SmPC search & full-document viewer for three sources:
 * - DailyMed (US SPL / prescribing info)
 * - eMC / medicines.org.uk (UK SmPC)
 * - drugs.com (US package insert / pro monograph)
 *
 * Full text for eMC & drugs.com (and DailyMed HTML labels) is fetched via
 * Jina Reader (https://r.jina.ai) because those sites block browser CORS.
 */

const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";
const DAILYMED_SPLS = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";
const JINA_PREFIX = "https://r.jina.ai/";

export const SMPC_SOURCE_OPTIONS = [
  {
    id: "dailymed",
    label: "DailyMed",
    hint: "نشرات FDA الأمريكية الكاملة (SPL)",
  },
  {
    id: "emc",
    label: "eMC",
    hint: "SmPC من medicines.org.uk",
  },
  {
    id: "drugs",
    label: "drugs.com",
    hint: "Package Insert / Prescribing Information",
  },
];

/** Extra OpenFDA fields appended when XML/HTML hydration is unavailable. */
const OPENFDA_EXTRA_FIELDS = [
  { key: "boxed_warning", title: "Boxed warning", fields: ["boxed_warning"] },
  { key: "purpose", title: "Purpose", fields: ["purpose"] },
  { key: "keep_out", title: "Keep out of reach of children", fields: ["keep_out_of_reach_of_children"] },
  { key: "questions", title: "Questions", fields: ["questions"] },
  { key: "information_for_patients", title: "Information for patients", fields: ["information_for_patients"] },
  { key: "use_in_specific_populations", title: "Use in specific populations", fields: ["use_in_specific_populations", "pediatric_use", "geriatric_use"] },
  { key: "nonclinical", title: "Nonclinical toxicology", fields: ["nonclinical_toxicology", "carcinogenesis_and_mutagenesis_and_impairment_of_fertility"] },
  { key: "clinical_studies", title: "Clinical studies", fields: ["clinical_studies", "clinical_studies_table"] },
  { key: "risks", title: "Risks", fields: ["risks"] },
  { key: "spl_patient", title: "Patient package insert", fields: ["spl_patient_package_insert", "spl_patient_package_insert_table"] },
];

const SECTION_MAP = [
  { key: "product_overview", title: "1. Name of the medicinal product", fields: [] },
  { key: "qualitative_quantitative", title: "2. Qualitative and quantitative composition", fields: ["active_ingredient", "inactive_ingredient", "spl_product_data_elements"] },
  { key: "pharmaceutical_form", title: "3. Pharmaceutical form", fields: ["dosage_forms_and_strengths", "description"] },
  { key: "indications", title: "4.1 Therapeutic indications", fields: ["indications_and_usage", "purpose"] },
  { key: "posology", title: "4.2 Posology and method of administration", fields: ["dosage_and_administration"] },
  { key: "contraindications", title: "4.3 Contraindications", fields: ["contraindications", "do_not_use"] },
  { key: "warnings", title: "4.4 Special warnings and precautions", fields: ["warnings", "warnings_and_cautions", "boxed_warning", "ask_doctor", "ask_doctor_or_pharmacist", "when_using", "stop_use", "precautions"] },
  { key: "interactions", title: "4.5 Interaction with other medicinal products", fields: ["drug_interactions", "drug_interactions_table"] },
  { key: "pregnancy", title: "4.6 Fertility, pregnancy and lactation", fields: ["pregnancy", "pregnancy_or_breast_feeding", "nursing_mothers", "labor_and_delivery"] },
  { key: "undesirable_effects", title: "4.8 Undesirable effects", fields: ["adverse_reactions", "adverse_reactions_table"] },
  { key: "overdose", title: "4.9 Overdose", fields: ["overdosage"] },
  { key: "pharmacological", title: "5. Pharmacological properties", fields: ["clinical_pharmacology", "clinical_pharmacology_table", "mechanism_of_action", "pharmacodynamics", "pharmacokinetics", "pharmacokinetics_table", "microbiology"] },
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

function stripTags(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|summary|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sectionKey(title, index) {
  const slug = slugify(title).slice(0, 48) || `section-${index + 1}`;
  return `${index + 1}-${slug}`;
}

async function fetchJina(url, { format = "markdown", timeout = 45, waitFor = "" } = {}) {
  const headers = {
    Accept: "text/plain,*/*",
    "X-Return-Format": format,
    "X-Timeout": String(timeout),
  };
  if (waitFor) headers["X-Wait-For-Selector"] = waitFor;

  const response = await fetch(`${JINA_PREFIX}${url}`, { headers });
  if (!response.ok) {
    throw new Error(`تعذّر جلب المصدر عبر القارئ (${response.status})`);
  }
  return response.text();
}

function isBlockedOrMissing(text) {
  const sample = String(text || "").slice(0, 1200);
  return (
    /Access Denied/i.test(sample) ||
    /Page Not Found \(404\)/i.test(sample) ||
    /HTTP Error 403/i.test(sample) ||
    /could not find the page/i.test(sample)
  );
}

function parseMarkdownSections(markdown, { minBody = 12, requireNumbered = false } = {}) {
  const text = String(markdown || "")
    .replace(/\r/g, "")
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/^Markdown Content:\s*/m, "")
    .trim();

  // Prefer the body that starts at the first real label/SmPC heading
  const startMatchers = [
    /(?:^|\n)#{1,4}\s+FULL PRESCRIBING INFORMATION\b[^\n]*/im,
    /(?:^|\n)#{1,4}\s+\d{1,2}(?:\.\d+){0,3}\s+[A-Z][^\n[\]]{3,120}\s*$/m, // plain numbered heading (not TOC link)
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

  // If a TOC of linked headings appears before the narrative body, jump to the first
  // plain numbered markdown heading (## 2.1 ... without a markdown link).
  const plainBody = body.search(/^#{1,4}\s+\d{1,2}(?:\.\d+){0,3}\s+[A-Z][^\n[\]]{3,120}\s*$/m);
  if (plainBody > 0) {
    const linkedBefore = (body.slice(0, plainBody).match(/^#{1,4}\s+\[[^\]]+\]\([^)]+\)/gm) || []).length;
    if (linkedBefore >= 3) body = body.slice(plainBody);
  }

  // Truncate footer chrome common on commercial drug sites
  body = body.split(
    /\n#{1,4}\s+(?:Related\/similar drugs|Frequently asked questions|More about |Professional resources|Other brands|Related treatment guides|Patient resources)\b/i
  )[0];

  const lines = body.split("\n");
  const sections = [];
  let current = null;

  const isHeading = (line) => {
    // Skip truncated / wrapped TOC link headings
    if (/^#{1,4}\s+\[[^\]]+\]\([^)]*$/.test(line)) return "";
    const h = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (h) {
      let title = h[1]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/^\[[^\]]*\]\([^)]*\)/, "")
        .trim();
      // Drop incomplete markdown link leftovers
      if (title.includes("](") || title.startsWith("[")) return "";
      return title;
    }
    const numbered = line.match(/^(\d{1,2}(?:\.\d+){0,3})\s+([A-Z][A-Za-z0-9].{2,140})$/);
    if (numbered) {
      const major = Number(numbered[1].split(".")[0]);
      if (major >= 1 && major <= 16) return `${numbered[1]} ${numbered[2]}`.trim();
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
      if (requireNumbered && !/^\d+(?:\.\d+)*\b/.test(heading) && !/HIGHLIGHTS|BOXED WARNING|DESCRIPTION|CLINICAL|INDICATIONS|DOSAGE|CONTRAINDICATIONS|WARNINGS|ADVERSE|DRUG INTERACTIONS|USE IN SPECIFIC|OVERDOSAGE|HOW SUPPLIED|PATIENT COUNSELING/i.test(heading)) {
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
    .map((section, index) => ({
      key: sectionKey(section.title, index),
      title: section.title,
      text: section.text
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    }))
    .filter((section) => section.text.length >= minBody);
}

function parseEmcHtml(html) {
  const start = html.search(/id=["']smpc["']|class=["']spcWrapper["']/i);
  const block = start >= 0 ? html.slice(start) : html;

  const sections = [];
  const detailRe =
    /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*<div class="sectionWrapper">([\s\S]*?)<\/div>\s*<\/details>/gi;
  let match;
  while ((match = detailRe.exec(block))) {
    const title = stripTags(match[1]);
    const text = stripTags(match[2]);
    if (!title) continue;
    if (/my account|cookie|sign in|accept all|expand all/i.test(title)) continue;
    // Keep SmPC-looking headings (numbered) and known section labels
    if (!/^\d+(\.\d+)*\b/.test(title) && !/name of the medicinal|composition|pharmaceutical|clinical|indication|posology|contraindic|warning|interaction|pregnancy|undesirable|overdose|pharmacolog|marketing authorisation|excipient|shelf|storage|packag|nature and contents/i.test(title)) {
      continue;
    }
    sections.push({
      key: sectionKey(title, sections.length),
      title,
      text: text || "(See subsections below.)",
    });
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
      return { key: section.key, title: section.title, text: lines.join("\n") };
    }
    const text = section.fields.map((field) => asText(item[field])).filter(Boolean).join("\n\n");
    return { key: section.key, title: section.title, text };
  }).filter((section) => section.text);

  // Catch-all: any remaining lengthy OpenFDA string fields not already mapped
  const used = new Set(SECTION_MAP.flatMap((section) => section.fields));
  Object.keys(item)
    .filter((key) => !used.has(key) && !["openfda", "set_id", "id", "version", "effective_time"].includes(key))
    .forEach((key) => {
      const text = asText(item[key]);
      if (text.length < 40) return;
      if (sections.some((section) => section.text.includes(text.slice(0, 80)))) return;
      sections.push({
        key: sectionKey(key, sections.length),
        title: key.replace(/_/g, " "),
        text,
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

async function searchDailyMedSource(query, { limit = 8 } = {}) {
  // DailyMed JSON is not CORS-enabled in browsers. Prefer OpenFDA (CORS *),
  // and optionally enrich listing titles via Jina→DailyMed search.
  const seen = new Set();
  const results = [];

  try {
    const raw = await fetchJina(
      `${DAILYMED_SPLS}?drug_name=${encodeURIComponent(query)}&pagesize=${limit}`,
      { format: "text", timeout: 35 }
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      for (const item of data.data || []) {
        const doc = normalizeDailyMedListing(item);
        if (!doc.setId || seen.has(doc.setId)) continue;
        seen.add(doc.setId);
        results.push(doc);
        if (results.length >= limit) break;
      }
    }
  } catch {
    /* fall back to OpenFDA */
  }

  if (results.length >= limit) return results.slice(0, limit);

  for (const expr of buildQueryVariants(query)) {
    if (results.length >= limit) break;
    try {
      const batch = await fetchOpenFda(expr, Math.min(6, limit));
      for (const item of batch) {
        const setId = item.set_id || item.id;
        if (!setId || seen.has(setId)) continue;
        seen.add(setId);
        const doc = normalizeOpenFda(item);
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

  return results.slice(0, limit);
}

function parseEmcSearch(markdownOrHtml, { limit = 8 } = {}) {
  const text = String(markdownOrHtml || "");
  const found = [];
  const seen = new Set();

  const patterns = [
    /\[([^\]]+?)\]\((https?:\/\/www\.medicines\.org\.uk\/emc\/product\/(\d+)\/smpc)\)/gi,
    /href="(https?:\/\/www\.medicines\.org\.uk\/emc\/product\/(\d+)\/smpc)"[^>]*>\s*([^<]{3,160})/gi,
    /https?:\/\/www\.medicines\.org\.uk\/emc\/product\/(\d+)\/smpc/gi,
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

async function searchEmcSource(query, { limit = 8 } = {}) {
  const searchUrl = `https://www.medicines.org.uk/emc/search?q=${encodeURIComponent(query)}&docType=smpc`;
  let payload = "";
  try {
    payload = await fetchJina(searchUrl, {
      format: "markdown",
      timeout: 50,
      waitFor: "a[href*='/emc/product/']",
    });
  } catch {
    payload = await fetchJina(searchUrl, { format: "html", timeout: 50 });
  }
  let results = parseEmcSearch(payload, { limit });
  if (!results.length) {
    // HTML pass if markdown missed anchors
    const html = await fetchJina(searchUrl, { format: "html", timeout: 50 });
    results = parseEmcSearch(html, { limit });
  }
  return results;
}

async function searchDrugsComSource(query, { limit = 8 } = {}) {
  const q = String(query || "").trim();
  const candidates = new Map();

  const addCandidate = (name, hint = "") => {
    const slug = slugify(name);
    if (!slug || slug.length < 3) return;
    if (candidates.has(slug)) return;
    candidates.set(slug, {
      id: `drugs:${slug}`,
      source: "drugs",
      sourceLabel: "drugs.com",
      title: name,
      api: hint || name,
      formulation: "Package insert (Pro)",
      manufacturer: "",
      slug,
      url: `https://www.drugs.com/pro/${slug}.html`,
      sections: [],
      englishText: name,
      needsFullLabel: true,
      hydrated: false,
    });
  };

  addCandidate(q);
  // Single-token and de-branded variants
  q.split(/[\/,|]/).map((part) => part.trim()).filter(Boolean).forEach((part) => addCandidate(part));

  for (const expr of buildQueryVariants(q)) {
    try {
      const batch = await fetchOpenFda(expr, Math.min(limit, 6));
      for (const item of batch) {
        const fda = item.openfda || {};
        for (const brand of fda.brand_name || []) addCandidate(brand, joinList(fda.generic_name));
        for (const generic of fda.generic_name || []) addCandidate(String(generic).split(",")[0], generic);
        for (const substance of fda.substance_name || []) addCandidate(substance);
      }
    } catch {
      /* continue */
    }
    if (candidates.size >= limit * 2) break;
  }

  // Prefer shorter / exact slugs first
  const ordered = [...candidates.values()].sort((a, b) => a.slug.length - b.slug.length);
  return ordered.slice(0, limit);
}

export async function searchSmpc(query, { limit = 8, source = "dailymed" } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const src = SMPC_SOURCE_OPTIONS.some((item) => item.id === source) ? source : "dailymed";

  if (src === "emc") return searchEmcSource(q, { limit });
  if (src === "drugs") return searchDrugsComSource(q, { limit });
  return searchDailyMedSource(q, { limit });
}

async function hydrateDailyMedFull(doc) {
  if (!doc?.setId) return doc;

  try {
    const markdown = await fetchJina(
      `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${doc.setId}`,
      { format: "markdown", timeout: 60 }
    );
    if (!isBlockedOrMissing(markdown)) {
      let sections = parseMarkdownSections(markdown, { minBody: 20, requireNumbered: true });
      if (sections.length < 5) {
        sections = parseMarkdownSections(markdown, { minBody: 20, requireNumbered: false });
      }
      // Keep substantive clinical/label sections; drop tiny chrome leftovers
      sections = sections.filter(
        (section) =>
          section.text.length >= 40 ||
          /^\d+(?:\.\d+)*\b/.test(section.title) ||
          /indication|dosage|warning|adverse|interaction|description|clinical|contraindic|overdose|how supplied|storage|pregnancy|nursing|pediatric|geriatric|active ingredient|purpose|uses|directions/i.test(
            section.title
          )
      );
      if (sections.length >= 3) {
        return {
          ...doc,
          sourceLabel: "DailyMed",
          sections,
          englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
          hydrated: true,
          needsFullLabel: false,
        };
      }
    }
  } catch {
    /* fall through */
  }

  try {
    const results = await fetchOpenFda(`set_id:"${doc.setId}"`, 1);
    if (results.length) {
      const full = normalizeOpenFda(results[0]);
      return {
        ...full,
        title: doc.title || full.title,
        hydrated: true,
        needsFullLabel: false,
      };
    }
  } catch {
    /* keep original */
  }
  return doc;
}

async function hydrateEmcFull(doc) {
  const url = doc.url || (doc.productId ? `https://www.medicines.org.uk/emc/product/${doc.productId}/smpc` : "");
  if (!url) return doc;

  const html = await fetchJina(url, {
    format: "html",
    timeout: 60,
    waitFor: "#smpc details, .spcWrapper details",
  });
  if (isBlockedOrMissing(html)) {
    throw new Error("تعذّر تحميل SmPC من eMC.");
  }
  const sections = parseEmcHtml(html);
  if (!sections.length) {
    throw new Error("لم يُعثر على أقسام SmPC في صفحة eMC.");
  }

  // Prefer product title from page <title>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  let title = doc.title;
  if (titleMatch) {
    title = stripTags(titleMatch[1])
      .replace(/\s*-\s*Summary of Product Characteristics.*$/i, "")
      .replace(/\s*\|\s*\d+\s*$/i, "")
      .trim() || title;
  }

  return {
    ...doc,
    title,
    sourceLabel: "eMC (medicines.org.uk)",
    url,
    sections,
    englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
    hydrated: true,
    needsFullLabel: false,
  };
}

async function hydrateDrugsComFull(doc) {
  const slugCandidates = [...new Set([
    doc.slug,
    slugify(doc.title),
    slugify(doc.api),
    slugify(String(doc.api || "").split(",")[0]),
    slugify(String(doc.title || "").split(/\s+/)[0]),
  ].filter(Boolean))];

  let lastError = null;
  for (const slug of slugCandidates) {
    const url = `https://www.drugs.com/pro/${slug}.html`;
    try {
      const markdown = await fetchJina(url, { format: "markdown", timeout: 60 });
      if (isBlockedOrMissing(markdown)) {
        lastError = new Error(`لا توجد نشرة drugs.com/pro لـ ${slug}`);
        continue;
      }
      const sections = parseDrugsComMarkdown(markdown);
      if (!sections.length) {
        lastError = new Error("تعذّر استخراج أقسام نشرة drugs.com.");
        continue;
      }
      const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
      const title = titleMatch
        ? titleMatch[1].replace(/\s*:\s*Package Insert.*$/i, "").trim()
        : doc.title;
      return {
        ...doc,
        title: title || doc.title,
        slug,
        sourceLabel: "drugs.com",
        url,
        sections,
        englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
        hydrated: true,
        needsFullLabel: false,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("لا توجد نشرة drugs.com/pro لهذه التسمية، أو الصفحة محجوبة.");
}

export async function hydrateSmpcDocument(doc, { onStatus } = {}) {
  if (!doc) return doc;
  if (doc.hydrated && doc.sections?.length >= 8 && !doc.needsFullLabel) return doc;

  if (doc.source === "emc") {
    onStatus?.("جارٍ تحميل SmPC الكامل من eMC…");
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
    return `<p class="muted search-empty">لا توجد نتائج SmPC لهذا المصدر. جرّب اسماً آخر أو غيّر المصدر (DailyMed / eMC / drugs.com).</p>`;
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
            <div class="smpc-section-body">${escapeHtml(section.text).replace(/\n/g, "<br>")}</div>
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
