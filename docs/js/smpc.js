/**
 * SmPC search & full-document viewer for three sources:
 * - DailyMed (US SPL / prescribing info)
 * - eMC / medicines.org.uk (UK SmPC)
 * - drugs.com (US package insert — content via FDA/DailyMed when site blocks bots)
 *
 * Sites without CORS are loaded through public readers/proxies with fallbacks.
 */

const OPENFDA_LABEL = "https://api.fda.gov/drug/label.json";
const OPENFDA_NDC = "https://api.fda.gov/drug/ndc.json";
const DAILYMED_SPLS = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";
const JINA_PREFIX = "https://r.jina.ai/";
const ALLORIGINS_RAW = "https://api.allorigins.win/raw?url=";
const PROXY_PREF_KEY = "smpc_proxy_pref_v3";

export const SMPC_SOURCE_OPTIONS = [
  {
    id: "all",
    label: "الكل",
    hint: "بحث في DailyMed + eMC + drugs.com",
  },
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
    .replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(td|th)[^>]*>/gi, "")
    .replace(/<img[^>]*alt=["']([^"']+)["'][^>]*>/gi, "\n[Image: $1]\n")
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "\n[Image]\n")
    .replace(/<img[^>]*>/gi, "\n[Image]\n")
    .replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, "\n($1)\n")
    .replace(/<(figure|picture)[^>]*>/gi, "\n")
    .replace(/<\/(figure|picture)>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|summary|section)>/gi, "\n")
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
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .trim();
}

function sectionKey(title, index) {
  const slug = slugify(title).slice(0, 48) || `section-${index + 1}`;
  return `${index + 1}-${slug}`;
}

async function fetchWithTimeout(url, { timeoutMs = 28000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    const response = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
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

function buildProxyAttempts(target) {
  const attempts = [];
  for (const variant of buildJinaTargets(target)) {
    attempts.push({
      name: "jina",
      timeoutMs: 32000,
      run: () => fetchWithTimeout(`${JINA_PREFIX}${variant}`, { timeoutMs: 32000 }),
    });
  }
  // Short timeouts — allorigins is often down (5xx) and should not block the UX.
  attempts.push({
    name: "allorigins",
    timeoutMs: 10000,
    run: () => fetchWithTimeout(`${ALLORIGINS_RAW}${encodeURIComponent(target)}`, { timeoutMs: 10000 }),
  });
  attempts.push({
    name: "allorigins-json",
    timeoutMs: 10000,
    run: async () => {
      const raw = await fetchWithTimeout(
        `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
        { timeoutMs: 10000 }
      );
      const data = JSON.parse(raw);
      if (!data?.contents) throw new Error("empty");
      return String(data.contents);
    },
  });
  attempts.push({
    name: "corsproxy-org",
    timeoutMs: 14000,
    run: () =>
      fetchWithTimeout(`https://corsproxy.org/?${encodeURIComponent(target)}`, {
        timeoutMs: 14000,
      }),
  });
  return attempts;
}

async function fetchRemotePage(url, { preferHtml = false } = {}) {
  const target = String(url || "").trim();
  if (!target) throw new Error("رابط المصدر فارغ.");

  // preferHtml is retained for callers, but we never send custom headers:
  // browser CORS preflight on X-Return-Format was a common "Failed to fetch" cause.
  void preferHtml;

  const attempts = buildProxyAttempts(target);
  const pref = preferredProxyName();
  if (pref) {
    attempts.sort((a, b) => Number(b.name.startsWith(pref)) - Number(a.name.startsWith(pref)));
  }

  const errors = [];

  // Race the first two Jina variants — usually enough and faster than serial waits.
  const jinaAttempts = attempts.filter((item) => item.name === "jina").slice(0, 2);
  if (jinaAttempts.length) {
    try {
      const text = await Promise.any(
        jinaAttempts.map(async (attempt) => {
          const value = await attempt.run();
          if (!value || value.length < 80) throw new Error("empty");
          if (isBlockedOrMissing(value)) throw new Error("blocked");
          return value;
        })
      );
      rememberProxy("jina");
      return { text, via: "jina" };
    } catch (error) {
      const details = error?.errors?.map((e) => e?.message || e).join(", ") || error?.message || "race failed";
      errors.push(`jina-race: ${details}`);
    }
  }

  for (const attempt of attempts) {
    if (attempt.name === "jina" && jinaAttempts.includes(attempt)) continue;
    try {
      const text = await attempt.run();
      if (!text || text.length < 80) {
        errors.push(`${attempt.name}: empty`);
        continue;
      }
      if (isBlockedOrMissing(text)) {
        errors.push(`${attempt.name}: blocked`);
        continue;
      }
      rememberProxy(attempt.name);
      return { text, via: attempt.name };
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
  const chars = sections.reduce((n, s) => n + String(s.text || "").length, 0);
  const clinical = sections.filter((s) =>
    /indication|dosage|warning|adverse|interaction|contraindic|pharmacolog|overdose|description|clinical|composition|posology/i.test(
      s.title
    )
  ).length;
  return sections.length * 10 + Math.min(chars, 200000) / 200 + clinical * 25;
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

  for (const candidate of urls) {
    try {
      const { text: markdown } = await fetchRemotePage(candidate.url);
      if (isBlockedOrMissing(markdown) || markdown.length < 1500) continue;

      let sections = parseMarkdownSections(markdown, {
        minBody: 25,
        requireNumbered: candidate.preferNumbered,
      });
      if (sections.length < 6) {
        sections = parseMarkdownSections(markdown, { minBody: 25, requireNumbered: false });
      }
      sections = sections.filter(
        (section) =>
          section.text.length >= 40 ||
          /\[Image:/i.test(section.text) ||
          /\s\|\s/.test(section.text) ||
          /^\d+(?:\.\d+)*\b/.test(section.title) ||
          /indication|dosage|warning|adverse|interaction|description|clinical|contraindic|overdose|how supplied|storage|pregnancy|nursing|pediatric|geriatric|active ingredient|purpose|uses|directions|highlights|boxed|composition|pharmacolog/i.test(
            section.title
          )
      );

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
    // Prefer the richer body; if close, merge unique OpenFDA extras into HTML result.
    if (fromFda?.sections?.length && fdaScore > htmlScore * 1.15) {
      return fromFda;
    }
    if (fromFda?.sections?.length) {
      const have = new Set(htmlDoc.sections.map((s) => s.title.toLowerCase()));
      const extras = fromFda.sections.filter((s) => !have.has(String(s.title || "").toLowerCase()) && s.text?.length > 80);
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
    .map((section, index) => {
      let body = section.text
        // Keep image alt text so figure-only sections are not dropped.
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt) => {
          const label = String(alt || "").trim() || "figure / table image";
          return `\n[Image: ${label}]\n`;
        })
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Normalize markdown tables into readable rows.
        .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
        .replace(/^\|(.+)\|$/gm, (_, row) =>
          row
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(" | ")
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        key: sectionKey(section.title, index),
        title: section.title,
        text: body,
      };
    })
    .filter((section) => {
      if (section.text.length >= minBody) return true;
      // Keep short sections that still carry figure/table placeholders.
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
    let text = stripTags(rawBody);
    if (!title) return;
    if (/my account|cookie|sign in|accept all|expand all|print smpc|share/i.test(title)) return;
    if (!isEmcSectionTitle(title)) return;
    const key = title.toLowerCase();
    if (seen.has(key)) {
      // Merge duplicate headings (parent + nested) instead of dropping content.
      const existing = sections.find((s) => s.title.toLowerCase() === key);
      if (existing && text && !existing.text.includes(text.slice(0, 80))) {
        existing.text = `${existing.text}\n\n${text}`.trim();
      }
      return;
    }
    seen.add(key);
    sections.push({
      key: sectionKey(title, sections.length),
      title,
      text: text || "(See subsections below.)",
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

async function searchEmcSource(query, { limit = 8, filters = {} } = {}) {
  const f = normalizeSmpcFilters(filters);
  const searchQ = appendFilterKeywords(query, f);
  if (!searchQ) return [];

  const searchUrls = [
    `https://www.medicines.org.uk/emc/search?q=${encodeURIComponent(searchQ)}&docType=smpc`,
    `https://www.medicines.org.uk/emc/search?q=${encodeURIComponent(searchQ)}`,
    `https://medicines.org.uk/emc/search?q=${encodeURIComponent(searchQ)}&docType=smpc`,
  ];

  const errors = [];
  for (const searchUrl of searchUrls) {
    try {
      const { text: payload } = await fetchRemotePage(searchUrl, { preferHtml: false });
      const results = parseEmcSearch(payload, { limit: Math.max(limit * 2, 12) }).filter((doc) =>
        matchesClientFilters(doc, f)
      );
      if (results.length) return results.slice(0, limit);
      errors.push(`${searchUrl}: no parseable products`);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(
    `تعذّر بحث eMC حالياً (الوسطاء غير متاحين أو لا نتائج). جرّب مصدر DailyMed أو «الكل». ${errors[0] ? `· ${errors[0]}` : ""}`
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
  q.split(/[\/,|]/).map((part) => part.trim()).filter(Boolean).forEach((part) => addCandidate(part));

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
      const junkA = /care-one|topcare|leader|good-sense|equaline|kirkland|up-and-up|infant/i.test(a.slug) ? 1 : 0;
      const junkB = /care-one|topcare|leader|good-sense|equaline|kirkland|up-and-up|infant/i.test(b.slug) ? 1 : 0;
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
    // Interleave sources so the top of the list is diverse.
    const maxLen = Math.max(...batches.map((batch) => batch.length), 0);
    for (let i = 0; i < maxLen; i += 1) {
      for (const batch of batches) {
        const item = batch[i];
        if (!item) continue;
        const key = `${item.source}:${item.setId || item.productId || item.slug || item.id}`;
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

  // Filtered NDC search is richest for DailyMed / drugs.com
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

function parseEmcMarkdownSections(markdown) {
  const sections = parseMarkdownSections(markdown, { minBody: 15, requireNumbered: false });
  const filtered = sections.filter(
    (section) =>
      /^\d+(?:\.\d+)*\b/.test(section.title) ||
      /name of the medicinal|composition|pharmaceutical|clinical|indication|posology|contraindic|warning|interaction|pregnancy|undesirable|overdose|pharmacolog|excipient|shelf|storage|packag|nature and contents|marketing authorisation/i.test(
        section.title
      )
  );
  return filtered.length >= 3 ? filtered : sections;
}

async function hydrateEmcFull(doc) {
  const url = doc.url || (doc.productId ? `https://www.medicines.org.uk/emc/product/${doc.productId}/smpc` : "");
  if (!url) return doc;

  const urls = [
    url,
    url.replace("https://www.medicines.org.uk", "https://medicines.org.uk"),
    url.replace("https://www.", "http://www."),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  let lastError = null;
  for (const candidate of urls) {
    try {
      const { text, via } = await fetchRemotePage(candidate, { preferHtml: false });
      if (isBlockedOrMissing(text)) {
        lastError = new Error("blocked");
        continue;
      }

      let sections = [];
      if (/<details[\s>]/i.test(text) || /spcWrapper/i.test(text)) {
        sections = parseEmcHtml(text);
      }
      if (sections.length < 3) {
        sections = parseEmcMarkdownSections(text);
      }
      if (!sections.length) {
        lastError = new Error("no sections");
        continue;
      }

      const titleMatch =
        text.match(/<title>([^<]+)<\/title>/i) || text.match(/^Title:\s*(.+)$/m);
      let title = doc.title;
      if (titleMatch) {
        title =
          stripTags(titleMatch[1])
            .replace(/\s*-\s*Summary of Product Characteristics.*$/i, "")
            .replace(/\s*\|\s*\d+\s*$/i, "")
            .trim() || title;
      }

      return {
        ...doc,
        title,
        sourceLabel: "eMC (medicines.org.uk)",
        url: candidate.startsWith("http") ? candidate.replace(/^http:/, "https:") : url,
        sections,
        englishText: sections.map((s) => `${s.title}\n${s.text}`).join("\n\n"),
        hydrated: true,
        needsFullLabel: false,
        fetchVia: via,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `تعذّر تحميل SmPC من eMC. ${lastError?.message || ""}`.trim()
  );
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
