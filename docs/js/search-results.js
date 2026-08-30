import { GROUP_ICONS, fileGroup } from "./constants.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function coerceHit(hit) {
  const nested = hit?.chunk && typeof hit.chunk === "object" ? hit.chunk : null;
  const content = nested?.content ?? hit?.content ?? nested?.text ?? hit?.text ?? "";
  return {
    chunk: {
      docId: nested?.docId ?? hit?.docId ?? "",
      filename: nested?.filename ?? hit?.filename ?? "مستند",
      category: nested?.category ?? hit?.category ?? "عام",
      content: String(content),
    },
    score: Number(hit?.score) || 0,
  };
}

export function highlightText(text, query) {
  const escaped = escapeHtml(String(text ?? ""));
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return escaped;
  const tokens = [...new Set(safeQuery.split(/\s+/).filter((token) => token.length >= 2))]
    .sort((a, b) => b.length - a.length);
  let result = escaped;
  for (const token of tokens) {
    const escToken = escapeHtml(token);
    const pattern = new RegExp(escToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    result = result.replace(pattern, '<mark class="query-hit">$&</mark>');
  }
  return result;
}

function excerptAroundQuery(text, query, radius = 140) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return { text: "", hasBefore: false, hasAfter: false };

  const tokens = [...new Set(String(query || "").split(/\s+/).filter((token) => token.length >= 2))];
  let anchor = -1;
  const lower = normalized.toLowerCase();
  for (const token of tokens.sort((a, b) => b.length - a.length)) {
    const idx = lower.indexOf(token.toLowerCase());
    if (idx >= 0 && (anchor < 0 || idx < anchor)) anchor = idx;
  }

  if (anchor < 0) {
    return {
      text: normalized.slice(0, radius * 2),
      hasBefore: false,
      hasAfter: normalized.length > radius * 2,
    };
  }

  const start = Math.max(0, anchor - radius);
  const end = Math.min(normalized.length, anchor + radius);
  return {
    text: normalized.slice(start, end),
    hasBefore: start > 0,
    hasAfter: end < normalized.length,
  };
}

function rankLabel(index) {
  if (index === 0) return { label: "الأعلى تطابقاً", className: "rank-gold" };
  if (index === 1) return { label: `#${index + 1}`, className: "rank-silver" };
  if (index === 2) return { label: `#${index + 1}`, className: "rank-bronze" };
  return { label: `#${index + 1}`, className: "rank-plain" };
}

function normalizeScores(hits) {
  const max = Math.max(...hits.map((hit) => hit.score), 1e-9);
  return hits.map((hit) => ({
    ...hit,
    pct: Math.max(0, Math.round((hit.score / max) * 100)),
  }));
}

function groupHits(hits) {
  const groups = new Map();
  for (const hit of hits) {
    const { docId, filename, category, content } = hit.chunk;
    if (!groups.has(docId)) {
      groups.set(docId, {
        docId,
        filename,
        category,
        snippets: [],
        bestScore: 0,
      });
    }
    const group = groups.get(docId);
    group.snippets.push({ content, score: hit.score, pct: hit.pct ?? 0 });
    group.bestScore = Math.max(group.bestScore, hit.score);
  }
  return [...groups.values()]
    .map((group) => {
      const snippets = [...group.snippets].sort((a, b) => b.score - a.score);
      return {
        ...group,
        snippets,
        pct: snippets[0]?.pct ?? 0,
      };
    })
    .sort((a, b) => b.bestScore - a.bestScore);
}

function renderSnippet(snippet, query, index, docId) {
  const content = String(snippet.content ?? "");
  const excerpt = excerptAroundQuery(content, query);
  const snippetId = `snippet-${docId}-${index}`;
  const isLong = content.replace(/\s+/g, " ").trim().length > excerpt.text.length + 40;
  const pct = snippet.pct ?? 0;

  return `
    <details class="search-snippet" ${index === 0 ? "open" : ""}>
      <summary class="search-snippet-summary">
        <span class="search-snippet-pill">مقطع ${index + 1}</span>
        <span class="search-snippet-score">${pct}%</span>
      </summary>
      <div class="search-snippet-body">
        <p class="search-snippet-text">
          ${excerpt.hasBefore ? '<span class="search-ellipsis">…</span>' : ""}
          ${highlightText(excerpt.text || content.slice(0, 280), query)}
          ${excerpt.hasAfter ? '<span class="search-ellipsis">…</span>' : ""}
        </p>
        ${
          isLong
            ? `<button class="btn ghost small search-expand-btn" type="button" data-target="${snippetId}" aria-expanded="false">عرض المقطع كاملاً</button>
               <div id="${snippetId}" class="search-snippet-full hidden">${highlightText(content, query)}</div>`
            : ""
        }
      </div>
    </details>`;
}

export function renderSearchResults(hits, query, docMeta = new Map()) {
  const normalizedHits = (Array.isArray(hits) ? hits : [])
    .map(coerceHit)
    .filter((hit) => hit.chunk.content.trim());

  if (!normalizedHits.length) {
    return `<p class="muted search-empty">لم يُعثر على مقاطع مطابقة. جرّب عبارة أوسع.</p>`;
  }

  const scored = normalizeScores(normalizedHits);
  const groups = groupHits(scored);
  const docCount = groups.length;
  const snippetCount = scored.length;

  const cards = groups
    .map((group, index) => {
      const rank = rankLabel(index);
      const meta = docMeta.get(group.docId) || {};
      const icon = GROUP_ICONS[meta.fileGroup || fileGroup(group.filename)] || GROUP_ICONS.other;
      const pct = group.pct ?? 0;

      return `
        <article class="search-result-card ${rank.className}" style="--relevance:${pct}%">
          <div class="search-result-rank" aria-hidden="true">${rank.label}</div>
          <header class="search-result-head">
            <div class="search-result-icon" aria-hidden="true">${icon}</div>
            <div class="search-result-meta">
              <h3 class="search-result-title">${escapeHtml(group.filename)}</h3>
              <div class="search-result-tags">
                <span class="chip">${escapeHtml(group.category)}</span>
                <span class="search-result-count">${group.snippets.length} مقطع</span>
              </div>
            </div>
            <button class="btn ghost small search-download-btn" data-id="${escapeHtml(group.docId)}" type="button">تنزيل</button>
          </header>
          <div class="search-relevance" role="presentation" aria-hidden="true">
            <div class="search-relevance-track">
              <div class="search-relevance-fill"></div>
            </div>
            <span class="search-relevance-label">${pct}% تطابق</span>
          </div>
          <div class="search-snippet-stack">
            ${group.snippets.map((snippet, snippetIndex) => renderSnippet(snippet, query, snippetIndex, group.docId)).join("")}
          </div>
        </article>`;
    })
    .join("");

  return `
    <div class="search-results-shell">
      <div class="search-results-summary">
        <span class="search-summary-stat"><strong>${snippetCount}</strong> مقطع</span>
        <span class="search-summary-dot" aria-hidden="true">·</span>
        <span class="search-summary-stat"><strong>${docCount}</strong> مستند</span>
        <span class="search-summary-query muted">لـ «${escapeHtml(query)}»</span>
      </div>
      <div class="search-results-grid">${cards}</div>
    </div>`;
}

export function bindSearchResults(root, { onDownload }) {
  if (!root) return;

  root.querySelectorAll(".search-download-btn").forEach((btn) => {
    btn.addEventListener("click", () => onDownload(btn.dataset.id));
  });

  root.querySelectorAll(".search-expand-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = root.querySelector(`#${CSS.escape(btn.dataset.target || "")}`);
      if (!target) return;
      target.classList.toggle("hidden");
      const isOpen = !target.classList.contains("hidden");
      btn.setAttribute("aria-expanded", String(isOpen));
      btn.textContent = isOpen ? "إخفاء المقطع" : "عرض المقطع كاملاً";
    });
  });
}
