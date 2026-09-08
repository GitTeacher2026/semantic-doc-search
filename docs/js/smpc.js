const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";
const DAILYMED_SPLS = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";

export const SMPC_SOURCES = {
  openfda: "OpenFDA / DailyMed (US label ≈ SmPC)",
  medicines: "medicines.org.uk (EMC)",
  dailymed: "dailymed.nlm.nih.gov",
  drugs: "drugs.com",
};

const SECTION_MAP = [
  { key: "product_overview", title: "1. Name of the medicinal product", fields: [] },
  { key: "qualitative_quantitative", title: "2. Qualitative and quantitative composition", fields: ["active_ingredient", "inactive_ingredient", "spl_product_data_elements"] },
  { key: "pharmaceutical_form", title: "3. Pharmaceutical form", fields: ["dosage_forms_and_strengths", "description"] },
  { key: "clinical_particulars", title: "4. Clinical particulars", fields: [] },
  { key: "indications", title: "4.1 Therapeutic indications", fields: ["indications_and_usage", "purpose"] },
  { key: "posology", title: "4.2 Posology and method of administration", fields: ["dosage_and_administration"] },
  { key: "contraindications", title: "4.3 Contraindications", fields: ["contraindications", "do_not_use"] },
  { key: "warnings", title: "4.4 Special warnings and precautions", fields: ["warnings", "warnings_and_cautions", "boxed_warning", "ask_doctor", "ask_doctor_or_pharmacist", "when_using", "stop_use", "precautions"] },
  { key: "interactions", title: "4.5 Interaction with other medicinal products", fields: ["drug_interactions"] },
  { key: "pregnancy", title: "4.6 Fertility, pregnancy and lactation", fields: ["pregnancy", "pregnancy_or_breast_feeding", "nursing_mothers", "labor_and_delivery"] },
  { key: "effects_driving", title: "4.7 Effects on ability to drive and use machines", fields: [] },
  { key: "undesirable_effects", title: "4.8 Undesirable effects", fields: ["adverse_reactions", "adverse_reactions_table"] },
  { key: "overdose", title: "4.9 Overdose", fields: ["overdosage"] },
  { key: "pharmacological", title: "5. Pharmacological properties", fields: ["clinical_pharmacology", "mechanism_of_action", "pharmacodynamics", "pharmacokinetics", "microbiology"] },
  { key: "pharmaceutical", title: "6. Pharmaceutical particulars", fields: ["how_supplied", "storage_and_handling", "package_label_principal_display_panel"] },
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

function first(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : "";
}

function joinList(arr, sep = ", ") {
  return Array.isArray(arr) ? arr.filter(Boolean).join(sep) : "";
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
    `openfda.dosage_form:"${escaped}"`,
    `description:"${escaped}"`,
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

async function searchOpenFdaLabels(query, { limit = 8 } = {}) {
  const variants = buildQueryVariants(query);
  const seen = new Set();
  const results = [];

  for (const expr of variants) {
    if (results.length >= limit) break;
    try {
      const batch = await fetchOpenFda(expr, Math.min(5, limit));
      for (const item of batch) {
        const id = item.set_id || item.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push(normalizeOpenFda(item));
        if (results.length >= limit) break;
      }
    } catch {
      /* try next variant */
    }
  }

  if (!results.length) {
    try {
      const loose = await fetchOpenFda(String(query).trim(), limit);
      for (const item of loose) {
        const id = item.set_id || item.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push(normalizeOpenFda(item));
      }
    } catch {
      /* empty */
    }
  }

  return results;
}

async function searchDailyMed(query, { limit = 8 } = {}) {
  const url = `${DAILYMED_SPLS}?drug_name=${encodeURIComponent(query)}&pagesize=${limit}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []).map(normalizeDailyMed);
  } catch {
    return [];
  }
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

  return {
    id: item.set_id || item.id,
    source: "openfda",
    sourceLabel: "OpenFDA Drug Label (US)",
    title: brand || generic || "Untitled product",
    api: generic,
    formulation: [form, strength, route].filter(Boolean).join(" · "),
    manufacturer,
    setId: item.set_id || "",
    url: item.set_id
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.set_id}`
      : "https://dailymed.nlm.nih.gov/",
    externalLinks: buildExternalLinks(brand || generic, generic),
    sections,
    englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
  };
}

function normalizeDailyMed(item) {
  const title = item.title || item.spl_title || "DailyMed SPL";
  const setId = item.setid || item.set_id || "";
  return {
    id: setId || title,
    source: "dailymed",
    sourceLabel: "DailyMed",
    title,
    api: item.generic_name || "",
    formulation: item.dosage_form || "",
    manufacturer: item.published_date || "",
    setId,
    url: setId
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`
      : "https://dailymed.nlm.nih.gov/",
    externalLinks: buildExternalLinks(title, item.generic_name || title),
    sections: [
      {
        key: "note",
        title: "DailyMed listing",
        text: `Open the DailyMed page for the full prescribing information / SmPC-equivalent label.\nPublished: ${item.published_date || "n/a"}`,
      },
    ],
    englishText: `${title}\n${item.published_date || ""}`,
    needsFullLabel: Boolean(setId),
  };
}

function buildExternalLinks(name, api) {
  const q = encodeURIComponent(name || api || "");
  const apiQ = encodeURIComponent(api || name || "");
  return [
    {
      id: "medicines",
      label: "medicines.org.uk",
      url: `https://www.medicines.org.uk/emc/search?q=${q}`,
    },
    {
      id: "dailymed",
      label: "DailyMed",
      url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${apiQ}`,
    },
    {
      id: "drugs",
      label: "drugs.com",
      url: `https://www.drugs.com/search.php?searchterm=${q}`,
    },
  ];
}

export async function searchSmpc(query, { limit = 8 } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const [openFda, dailyMed] = await Promise.all([
    searchOpenFdaLabels(q, { limit }),
    searchDailyMed(q, { limit: Math.min(limit, 6) }),
  ]);

  const merged = [...openFda];
  const seen = new Set(openFda.map((item) => item.setId || item.id));
  for (const item of dailyMed) {
    const key = item.setId || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, limit);
}

export async function hydrateDailyMedLabel(doc) {
  if (!doc?.setId || !doc.needsFullLabel) return doc;
  try {
    const results = await fetchOpenFda(`set_id:"${doc.setId}"`, 1);
    if (!results.length) return doc;
    const full = normalizeOpenFda(results[0]);
    return {
      ...full,
      externalLinks: doc.externalLinks?.length ? doc.externalLinks : full.externalLinks,
    };
  } catch {
    return doc;
  }
}

export function renderSmpcSearchResults(docs) {
  if (!docs.length) {
    return `<p class="muted search-empty">لا توجد نتائج SmPC. جرّب اسم المادة الفعّالة (API) أو الاسم التجاري أو الشكل الصيدلاني.</p>`;
  }

  return `
    <div class="smpc-results-grid">
      ${docs
        .map(
          (doc, index) => `
        <article class="smpc-result-card" data-id="${escapeHtml(doc.id)}">
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
            ${(doc.externalLinks || [])
              .map(
                (link) =>
                  `<a class="btn ghost small" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`
              )
              .join("")}
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
        <p class="muted smpc-document-source" dir="${isArabic ? "rtl" : "ltr"}">المصدر: ${escapeHtml(doc.sourceLabel)} · البيانات المنظمة من OpenFDA/DailyMed مع روابط إلى medicines.org.uk و drugs.com</p>
      </header>
      <div class="smpc-sections">
        ${sections
          .map(
            (section) => `
          <section class="smpc-section" id="smpc-${escapeHtml(section.key)}">
            <h4>${escapeHtml(section.title)}</h4>
            <div class="smpc-section-body">${escapeHtml(section.text).replace(/\n/g, "<br>")}</div>
          </section>`
          )
          .join("")}
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
    "",
  ];
  for (const section of sections || []) {
    lines.push(section.title, section.text, "");
  }
  return lines.filter((line) => line !== undefined).join("\n");
}
