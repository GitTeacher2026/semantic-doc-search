import { includesNormalized, normalizeArabic } from "./arabic-text.js";

export function substringSearch(chunks, query, k = 5, category = null) {
  const needle = normalizeArabic(query);
  if (!needle || needle.length < 2) return [];

  const hits = [];
  for (const chunk of chunks) {
    if (category && chunk.category !== category) continue;
    const haystack = normalizeArabic(chunk.content);
    if (!includesNormalized(haystack, needle)) continue;
    const index = haystack.indexOf(needle);
    const proximity = index >= 0 ? 1 / (1 + index / 200) : 0.5;
    const density = (haystack.match(new RegExp(escapeRegExp(needle), "g")) || []).length;
    const score = proximity + Math.min(density, 5) * 0.1;
    hits.push({ chunk, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
