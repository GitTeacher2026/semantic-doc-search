import { PHARMACOPOEIA_DRIVE_FOLDER_ID } from "./config.js";

const INDEX_URL = new URL("../data/pharmacopoeia-index.json", import.meta.url).href;

let catalogItems = null;
let catalogMeta = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8212;/g, "—")
    .replace(/&#12296;/g, "〈")
    .replace(/&#12297;/g, "〉");
}

export function extractDriveFileId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text) && !text.includes("/")) return text;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/open\?id=([a-zA-Z0-9_-]+)/,
    /\/uc\?.*?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

export function driveViewUrl(fileId) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : "";
}

export function drivePreviewUrl(fileId) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/preview` : "";
}

export function driveDownloadUrl(fileId) {
  return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : "";
}

function expandItem(raw) {
  if (raw.title) {
    const driveFileId = raw.driveFileId || extractDriveFileId(raw.driveUrl || raw.previewUrl) || "";
    return {
      id: raw.id,
      title: decodeEntities(raw.title),
      pharmacopoeia: raw.pharmacopoeia || "OTHER",
      filename: raw.filename || `${decodeEntities(raw.title)}.pdf`,
      driveFileId,
      driveUrl: raw.driveUrl || driveViewUrl(driveFileId),
      previewUrl: raw.previewUrl || drivePreviewUrl(driveFileId),
      preview: raw.preview || `${raw.pharmacopoeia || ""} Monograph`,
    };
  }

  const title = decodeEntities(raw.t || "");
  const driveFileId = raw.d || "";
  return {
    id: raw.id,
    title,
    pharmacopoeia: raw.b || "OTHER",
    filename: `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100)}.pdf`,
    driveFileId,
    driveUrl: driveViewUrl(driveFileId),
    previewUrl: drivePreviewUrl(driveFileId),
    preview: raw.p || `${raw.b || ""} Monograph`,
  };
}

function scoreMonograph(item, query, queryTokens) {
  const title = normalize(item.title);
  const book = normalize(item.pharmacopoeia);
  const preview = normalize(item.preview);
  let score = 0;

  if (title === query) score += 100;
  else if (title.startsWith(query)) score += 50;
  else if (title.includes(query)) score += 25;

  for (const token of queryTokens) {
    if (!token) continue;
    if (title.includes(token)) score += token.length >= 4 ? 8 : 4;
    if (book === token || book.includes(token)) score += 6;
    if (preview.includes(token)) score += 2;
  }
  return score;
}

export async function loadPharmacopoeiaCatalog({ force = false } = {}) {
  if (catalogItems && !force) return { meta: catalogMeta, items: catalogItems };

  const response = await fetch(`${INDEX_URL}?v=20260908a`);
  if (!response.ok) throw new Error("تعذّر تحميل فهرس monographs من Web of Pharma.");
  const data = await response.json();

  const rawItems = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.monographs)
      ? data.monographs
      : [];

  catalogItems = rawItems.map(expandItem);
  catalogMeta = {
    version: data.v || data.version || 1,
    source: data.src || data.source || "",
    count: catalogItems.length,
    folderId: data.folderId || "",
  };
  return { meta: catalogMeta, items: catalogItems };
}

export function getConfiguredPharmaFolderId() {
  return String(PHARMACOPOEIA_DRIVE_FOLDER_ID || catalogMeta?.folderId || "").trim();
}

export function getPharmacopoeiaItems() {
  return catalogItems || [];
}

export function searchPharmacopoeia(query, { source = "", limit = 20 } = {}) {
  const items = catalogItems || [];
  const q = normalize(query).trim();
  const tokens = q.split(/[^a-z0-9\u0600-\u06ff+.-]+/i).filter((token) => token.length >= 2);
  let pool = source ? items.filter((item) => item.pharmacopoeia === source) : items;

  if (!q) {
    return pool.slice(0, limit).map((item) => ({ item, score: 1 }));
  }

  return pool
    .map((item) => ({ item, score: scoreMonograph(item, q, tokens) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit);
}

export function suggestPharmacopoeia(query, { limit = 12 } = {}) {
  return searchPharmacopoeia(query, { limit });
}

export function mergeDriveFolderIntoCatalog(files, { folderId = "", pharmacopoeia = "OTHER" } = {}) {
  const existing = new Map((catalogItems || []).map((item) => [item.driveFileId || item.id, item]));
  for (const file of files || []) {
    const driveFileId = file.id;
    if (!driveFileId) continue;
    const title = String(file.name || "Monograph").replace(/\.[^.]+$/, "");
    existing.set(driveFileId, {
      id: `drive-${driveFileId}`,
      title,
      pharmacopoeia: guessPharmacopoeia(file.name) || pharmacopoeia,
      filename: file.name,
      driveFileId,
      driveUrl: driveViewUrl(driveFileId),
      previewUrl: drivePreviewUrl(driveFileId),
      preview: `Google Drive file · ${file.mimeType || "document"}`,
    });
  }
  catalogItems = [...existing.values()];
  catalogMeta = {
    ...(catalogMeta || {}),
    folderId: folderId || catalogMeta?.folderId || "",
    count: catalogItems.length,
  };
  return { meta: catalogMeta, items: catalogItems };
}

function guessPharmacopoeia(filename) {
  const name = String(filename || "").toUpperCase();
  if (/\bUSP\b|USP-NF/.test(name)) return "USP";
  if (/\bBP\b|BRITISH/.test(name)) return "BP";
  if (/\bEP\b|PH\.?\s*EUR|EUROPEAN/.test(name)) return "EP";
  if (/\bJP\b|JAPANESE/.test(name)) return "JP";
  if (/\bCP\b|CHINESE/.test(name)) return "CP";
  if (/\bIPH\b|INTERNATIONAL/.test(name)) return "IPh";
  if (/\bIP\b|INDIAN/.test(name)) return "IP";
  return "";
}

export function renderPharmacopoeiaResults(hits, query) {
  if (!hits.length) {
    return `<p class="muted search-empty">لا توجد monographs مطابقة${query ? ` لـ «${escapeHtml(query)}»` : ""}.</p>`;
  }

  const cards = hits
    .map(({ item }, index) => {
      const hasLink = Boolean(item.driveFileId || item.driveUrl);
      const openHref = item.driveUrl || driveViewUrl(item.driveFileId);
      const previewHref = item.previewUrl || drivePreviewUrl(item.driveFileId);
      return `
      <article class="pharma-result-card" data-id="${escapeHtml(item.id)}" data-drive-id="${escapeHtml(item.driveFileId || "")}">
        <div class="pharma-result-head">
          <span class="pharma-rank">#${index + 1}</span>
          <span class="pharma-source-badge source-${escapeHtml(item.pharmacopoeia || "OTHER")}">${escapeHtml(item.pharmacopoeia || "OTHER")}</span>
        </div>
        <h3 class="pharma-result-title">${escapeHtml(item.title)}</h3>
        <p class="pharma-result-meta muted">${escapeHtml(item.preview || "")}</p>
        <div class="pharma-result-actions">
          ${
            hasLink
              ? `<button type="button" class="btn ghost small pharma-view-btn" data-preview="${escapeHtml(previewHref)}">عرض</button>
                 <a class="btn ghost small" href="${escapeHtml(openHref)}" target="_blank" rel="noopener noreferrer">فتح في Drive</a>`
              : `<span class="muted">لا يوجد رابط Drive</span>`
          }
          <button
            class="btn primary small pharma-leech-btn"
            type="button"
            data-id="${escapeHtml(item.id)}"
            data-drive-id="${escapeHtml(item.driveFileId || "")}"
            data-filename="${escapeHtml(item.filename || `${item.title}.pdf`)}"
            data-title="${escapeHtml(item.title)}"
            ${hasLink ? "" : " disabled"}
          >Leech → MEGA</button>
        </div>
      </article>`;
    })
    .join("");

  return `
    <div class="pharma-results-wrap">
      <p class="search-results-meta muted">${hits.length.toLocaleString("ar-EG")} نتيجة — مصدر الفهرس: Web of Pharma · روابط Google Drive</p>
      <div id="pharma-pdf-viewer" class="pharma-pdf-viewer hidden">
        <div class="pharma-pdf-toolbar">
          <span class="muted">معاينة Drive</span>
          <button type="button" class="btn ghost small" id="pharma-pdf-close">إغلاق</button>
        </div>
        <iframe id="pharma-pdf-frame" title="Pharmacopoeia PDF preview" loading="lazy"></iframe>
      </div>
      <div class="pharma-results-grid">${cards}</div>
    </div>`;
}

export function renderPharmacopoeiaSuggestions(hits) {
  if (!hits.length) return "";
  return hits
    .map(
      ({ item }) => `
    <button type="button" class="pharma-suggest-item" data-title="${escapeHtml(item.title)}">
      <span class="pharma-source-badge source-${escapeHtml(item.pharmacopoeia || "OTHER")}">${escapeHtml(item.pharmacopoeia || "OTHER")}</span>
      <span>${escapeHtml(item.title)}</span>
    </button>`
    )
    .join("");
}

export function bindPharmacopoeiaResults(root, { onLeech, onView } = {}) {
  if (!root) return;

  root.querySelectorAll(".pharma-leech-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      onLeech?.({
        id: btn.dataset.id,
        driveFileId: btn.dataset.driveId,
        filename: btn.dataset.filename,
        title: btn.dataset.title,
        button: btn,
      });
    });
  });

  root.querySelectorAll(".pharma-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.preview;
      const viewer = root.querySelector("#pharma-pdf-viewer");
      const frame = root.querySelector("#pharma-pdf-frame");
      if (viewer && frame && url) {
        frame.src = url;
        viewer.classList.remove("hidden");
        viewer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      onView?.(url);
    });
  });

  root.querySelector("#pharma-pdf-close")?.addEventListener("click", () => {
    const viewer = root.querySelector("#pharma-pdf-viewer");
    const frame = root.querySelector("#pharma-pdf-frame");
    if (frame) frame.src = "";
    viewer?.classList.add("hidden");
  });
}
