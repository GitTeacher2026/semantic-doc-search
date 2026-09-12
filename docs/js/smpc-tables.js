/**
 * MHRA / UK SpC table recovery.
 * Jina flattens PDF tables into prose; this module rebuilds HTML tables from
 * (1) PDF text positions via pdf.js when bytes are available, and
 * (2) MedDRA frequency-list heuristics on flattened markdown.
 */

import { getPdfJs, getPdfDocumentOptions } from "./pdf-utils.js";

const FREQ_RE =
  /\b(Very common|Common|Uncommon|Rare|Very rare|Not known|Frequency not known)\b/gi;

const MEDDRA_SOCS = [
  "Infections and infestations",
  "Neoplasms benign, malignant and unspecified \\(including cysts and polyps\\)",
  "Neoplasms benign, malignant and unspecified",
  "Blood and lymphatic system disorders",
  "Blood and the lymphatic system disorders",
  "Immune system disorders",
  "Endocrine disorders",
  "Metabolism and nutrition disorders",
  "Psychiatric disorders",
  "Nervous system disorders",
  "Eye disorders",
  "Ear and labyrinth disorders",
  "Cardiac disorders",
  "Vascular disorders",
  "Respiratory, thoracic and mediastinal disorders",
  "Gastrointestinal disorders",
  "Hepatobiliary disorders",
  "Skin and subcutaneous tissue disorders",
  "Musculoskeletal and connective tissue disorders",
  "Musculoskeletal, connective tissue and bone disorders",
  "Renal and urinary disorders",
  "Pregnancy, puerperium and perinatal conditions",
  "Reproductive system and breast disorders",
  "Congenital, familial and genetic disorders",
  "General disorders and administration site conditions",
  "Investigations",
  "Injury, poisoning and procedural complications",
  "Surgical and medical procedures",
  "Social circumstances",
  "Product issues",
];

const SOC_FIND_RE = new RegExp(
  `\\b(?:${MEDDRA_SOCS.join("|")})\\b`,
  "gi"
);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip characters illegal in XML 1.0 text nodes (common DOCX corruption source). */
export function sanitizeXmlText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFE|\uFFFF/g, "")
    .replace(/[\uD800-\uDFFF]/g, (ch, idx, full) => {
      const code = ch.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = full.charCodeAt(idx + 1);
        if (next >= 0xdc00 && next <= 0xdfff) return ch;
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        const prev = full.charCodeAt(idx - 1);
        if (prev >= 0xd800 && prev <= 0xdbff) return ch;
      }
      return "";
    });
}

export function matrixToHtmlTable(matrix, { caption = "" } = {}) {
  const rows = (matrix || [])
    .map((row) => (Array.isArray(row) ? row : [row]).map((c) => String(c ?? "").trim()))
    .filter((row) => row.some(Boolean));
  if (rows.length < 2) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push("");
    return copy;
  });

  const [header, ...body] = normalized;
  const thead = `<thead><tr>${header
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map(
      (row) =>
        `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`
    )
    .join("")}</tbody>`;
  const cap = caption ? `<caption>${escapeHtml(caption)}</caption>` : "";
  return `<table class="smpc-table">${cap}${thead}${tbody}</table>`;
}

/**
 * Rebuild MedDRA “System Organ Class / Frequency / Effects” tables that Jina
 * flattens into headings + run-on prose.
 */
export function rebuildMeddraFrequencyTables(markdown) {
  let text = String(markdown || "");
  if (!/System Organ Class/i.test(text) || !FREQ_RE.test(text)) return text;
  FREQ_RE.lastIndex = 0;

  const headerRe =
    /(?:^|\n)#{0,3}\s*System Organ Class\s+Frequency\s+(?:Undesirable effects|Adverse reactions|Adverse effects)\s*(?=\n|$)/gi;

  let match;
  const replacements = [];
  while ((match = headerRe.exec(text))) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const after = start + match[0].replace(/^\n/, "").length;
    const stopMatch = text.slice(after).search(
      /\n(?:#{0,3}\s*)?(?:Description of selected|Reporting of suspected|4\.9\b|5\s+PHARMACOLOG|6\s+PHARMACEUTICAL|Tabulated list of adverse reactions\b)/i
    );
    const end = stopMatch >= 0 ? after + stopMatch : Math.min(text.length, after + 12000);
    const block = text.slice(after, end);
    const rows = parseMeddraBlock(block);
    if (rows.length < 3) continue;
    const table = matrixToHtmlTable(
      [["System Organ Class", "Frequency", "Undesirable effects"], ...rows],
      { caption: "Tabulated list of adverse reactions" }
    );
    if (!table) continue;
    replacements.push({ start, end, table, preface: match[0].replace(/^\n/, "").trim() });
  }

  if (!replacements.length) return text;

  let out = text;
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const { start, end, table } = replacements[i];
    out = `${out.slice(0, start)}\n\n${table}\n\n${out.slice(end)}`;
  }
  return out;
}

function parseMeddraBlock(block) {
  let body = String(block || "")
    .replace(/^#+\s*/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Normalize frequency tokens for splitting.
  body = body.replace(FREQ_RE, (m) => `\n@@FREQ@@${m}@@`);
  SOC_FIND_RE.lastIndex = 0;
  body = body.replace(SOC_FIND_RE, (m) => `\n@@SOC@@${m}@@\n`);

  const rows = [];
  let currentSoc = "";
  let currentFreq = "";
  let buf = [];

  const flush = () => {
    const effects = buf.join(" ").replace(/\s+/g, " ").trim().replace(/^[,:;.\-\s]+/, "");
    if (currentSoc && currentFreq && effects) {
      rows.push([currentSoc, currentFreq, effects]);
    }
    buf = [];
  };

  for (const rawLine of body.split("\n")) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("@@SOC@@")) {
      flush();
      currentSoc = line.replace(/^@@SOC@@|@@$/g, "").trim();
      currentFreq = "";
      continue;
    }
    if (line.startsWith("@@FREQ@@")) {
      flush();
      const rest = line.replace(/^@@FREQ@@/, "");
      const parts = rest.split("@@");
      currentFreq = (parts[0] || "").trim();
      const remainder = parts.slice(1).join("").trim();
      // Jina often appends the *next* SOC after effects: "allergic reactions Immune system disorders"
      SOC_FIND_RE.lastIndex = 0;
      const trailingSoc = SOC_FIND_RE.exec(remainder);
      if (trailingSoc && trailingSoc.index > 0) {
        buf = [remainder.slice(0, trailingSoc.index).trim()];
        flush();
        currentSoc = trailingSoc[0];
        currentFreq = "";
        const after = remainder.slice(trailingSoc.index + trailingSoc[0].length).trim();
        buf = after ? [after] : [];
      } else if (trailingSoc && trailingSoc.index === 0) {
        currentSoc = trailingSoc[0];
        currentFreq = "";
        const after = remainder.slice(trailingSoc[0].length).trim();
        buf = after ? [after] : [];
      } else {
        buf = remainder ? [remainder] : [];
      }
      continue;
    }
    // Line may start with SOC without marker if regex missed — try again.
    SOC_FIND_RE.lastIndex = 0;
    const socHit = SOC_FIND_RE.exec(line);
    if (socHit && socHit.index === 0) {
      flush();
      currentSoc = socHit[0];
      currentFreq = "";
      const rest = line.slice(socHit[0].length).trim();
      if (rest) buf.push(rest);
      continue;
    }
    // Trailing SOC on a plain effects line.
    SOC_FIND_RE.lastIndex = 0;
    const trail = SOC_FIND_RE.exec(line);
    if (trail && trail.index > 0) {
      buf.push(line.slice(0, trail.index).trim());
      flush();
      currentSoc = trail[0];
      currentFreq = "";
      const after = line.slice(trail.index + trail[0].length).trim();
      buf = after ? [after] : [];
      continue;
    }
    buf.push(line);
  }
  flush();

  // Merge consecutive same SOC+freq rows.
  const merged = [];
  for (const row of rows) {
    const prev = merged[merged.length - 1];
    if (prev && prev[0] === row[0] && prev[1] === row[1]) {
      prev[2] = `${prev[2]}; ${row[2]}`.replace(/\s+/g, " ").trim();
    } else {
      merged.push([...row]);
    }
  }
  return merged;
}

/** Convert spaced “column” lines (3+ cells separated by 2+ spaces) into HTML tables. */
export function spacedColumnsToHtmlTables(markdown) {
  const lines = String(markdown || "").split("\n");
  const out = [];
  let i = 0;
  const isData = (line) => {
    if (/^\s*</.test(line) || /^\s*#/.test(line)) return false;
    const parts = String(line).trim().split(/\s{2,}/).filter(Boolean);
    return parts.length >= 3 && parts.every((p) => p.length <= 80);
  };

  while (i < lines.length) {
    if (isData(lines[i])) {
      const rows = [];
      while (i < lines.length && isData(lines[i])) {
        rows.push(lines[i].trim().split(/\s{2,}/).map((c) => c.trim()));
        i += 1;
      }
      if (rows.length >= 3) {
        const width = Math.max(...rows.map((r) => r.length));
        if (rows.filter((r) => r.length === width).length >= Math.ceil(rows.length * 0.6)) {
          out.push(matrixToHtmlTable(rows.map((r) => {
            const copy = [...r];
            while (copy.length < width) copy.push("");
            return copy;
          })));
          continue;
        }
      }
      out.push(...rows.map((r) => r.join("  ")));
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join("\n");
}

/**
 * Full markdown → table-aware markdown/HTML mix used before section enrich.
 */
export function restoreSpcTablesInMarkdown(markdown) {
  let text = String(markdown || "");
  text = rebuildMeddraFrequencyTables(text);
  text = spacedColumnsToHtmlTables(text);
  return text;
}

function clusterRows(items, yTol = 2.4) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= yTol);
    if (row) {
      row.items.push(it);
      row.y = row.items.reduce((sum, x) => sum + x.y, 0) / row.items.length;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

function detectColumns(rows) {
  const xs = [];
  for (const row of rows) {
    if (row.items.length < 2) continue;
    for (const it of row.items) xs.push(it.x);
  }
  if (xs.length < 6) return null;
  xs.sort((a, b) => a - b);
  const cols = [];
  for (const x of xs) {
    const hit = cols.find((c) => Math.abs(c.x - x) < 16);
    if (hit) {
      hit.n += 1;
      hit.x = (hit.x * (hit.n - 1) + x) / hit.n;
    } else {
      cols.push({ x, n: 1 });
    }
  }
  cols.sort((a, b) => a.x - b.x);
  const thr = Math.max(3, Math.floor(rows.length * 0.1));
  const kept = [];
  for (const col of cols.filter((c) => c.n >= thr)) {
    const prev = kept[kept.length - 1];
    if (prev && Math.abs(prev.x - col.x) < 20) {
      prev.x = (prev.x * prev.n + col.x * col.n) / (prev.n + col.n);
      prev.n += col.n;
    } else {
      kept.push({ ...col });
    }
  }
  return kept.length >= 2 ? kept : null;
}

function assignRow(row, cols) {
  const cells = cols.map(() => "");
  for (const it of row.items) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < cols.length; i += 1) {
      const d = Math.abs(cols[i].x - it.x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cells[best] = (cells[best] ? `${cells[best]} ` : "") + String(it.str || "").trim();
  }
  return cells.map((c) => c.replace(/\s+/g, " ").trim());
}

function mergeWrappedRows(matrix) {
  const out = [];
  for (const row of matrix) {
    const leadEmpty = !row[0] && row.slice(1).some(Boolean);
    const singleCont = row.filter(Boolean).length === 1 && out.length;
    if ((leadEmpty || singleCont) && out.length) {
      const prev = out[out.length - 1];
      for (let i = 0; i < row.length; i += 1) {
        if (row[i]) prev[i] = (prev[i] ? `${prev[i]} ` : "") + row[i];
      }
    } else {
      out.push([...row]);
    }
  }
  return out;
}

function extractTablesFromPageItems(items) {
  const rows = clusterRows(items);
  const cols = detectColumns(rows);
  if (!cols) return [];

  const matrix = mergeWrappedRows(
    rows.map((row) => assignRow(row, cols)).filter((row) => row.some(Boolean))
  );

  const tables = [];
  let block = [];
  const score = (row) => row.filter(Boolean).length;
  const flush = () => {
    if (block.length >= 3) {
      const multi = block.filter((row) => score(row) >= 2).length;
      if (multi >= 3) {
        // Drop leading prose-heavy junk rows (first cell very long).
        let start = 0;
        while (start < block.length && (block[start][0] || "").length > 120) start += 1;
        const slice = block.slice(start);
        if (slice.length >= 3) tables.push(slice);
      }
    }
    block = [];
  };

  for (const row of matrix) {
    if (score(row) >= 2) block.push(row);
    else flush();
  }
  flush();
  return tables;
}

/**
 * Extract tables from a UK SpC PDF using pdf.js glyph positions.
 * @returns {Promise<string[][][]>} list of matrices
 */
export async function extractTablesFromPdfBytes(bytes) {
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument(getPdfDocumentOptions(bytes)).promise;
  const tables = [];
  const maxPages = Math.min(pdf.numPages, 40);
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const items = (content.items || [])
      .filter((item) => String(item.str || "").trim())
      .map((item) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        w: item.width || 0,
      }));
    for (const matrix of extractTablesFromPageItems(items)) {
      tables.push(matrix);
    }
    page.cleanup?.();
  }
  return tables;
}

function tableFingerprint(matrix) {
  return (matrix || [])
    .flat()
    .map((c) => String(c || "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 4 && c.length <= 60)
    .slice(0, 8);
}

/**
 * Attach extracted PDF tables to matching SpC sections (as HTML).
 * Returns new section objects; does not mutate input.
 */
export function injectTablesIntoSections(sections, matrices) {
  if (!sections?.length || !matrices?.length) return sections;

  const used = new Set();
  return sections.map((section) => {
    const hay = `${section.title || ""}\n${section.text || ""}\n${section.html || ""}`.toLowerCase();
    const matched = [];
    matrices.forEach((matrix, idx) => {
      if (used.has(idx)) return;
      const tokens = tableFingerprint(matrix);
      if (tokens.length < 2) return;
      const hits = tokens.filter((tok) => hay.includes(tok.slice(0, 40))).length;
      if (hits >= Math.min(2, tokens.length)) {
        used.add(idx);
        matched.push(matrix);
      }
    });
    if (!matched.length) return section;

    const tablesHtml = matched.map((m) => matrixToHtmlTable(m)).filter(Boolean).join("\n");
    // Prefer replacing empty/non-table html; keep existing rich html and append tables once.
    let html = String(section.html || "");
    if (/<table\b/i.test(html)) {
      // Avoid duplicate injection when MedDRA reconstructor already built a table.
      const existingText = html.replace(/<[^>]+>/g, " ").toLowerCase();
      const novel = matched.filter((matrix) => {
        const fp = tableFingerprint(matrix).slice(0, 3);
        return fp.filter((tok) => existingText.includes(tok.slice(0, 40))).length < 2;
      });
      if (!novel.length) return section;
      html = `${html}\n${novel.map((m) => matrixToHtmlTable(m)).join("\n")}`;
    } else {
      // Build rich body: paragraphs from text + tables
      const paras = String(section.text || "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => {
          // Drop lines that are clearly flattened table remnants now recovered.
          const fp = matched.flatMap(tableFingerprint).slice(0, 12);
          const lower = p.toLowerCase();
          const hit = fp.filter((tok) => lower.includes(tok.slice(0, 30))).length;
          return hit < 2;
        })
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join("\n");
      html = `${paras}\n${tablesHtml}`;
    }

    return {
      ...section,
      html,
      text: section.text,
    };
  });
}
