import { STOPWORDS, tokenize as baseTokenize } from "../bm25-search.js";

export function normalizeArabic(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeArabic(text) {
  const normalized = normalizeArabic(text);
  return (normalized.match(/[\u0600-\u06FF]{2,}|[a-z0-9]{2,}/gi) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => !STOPWORDS.has(token));
}

export function tokenizeForEngine(engineId, text) {
  if (engineId === "bm25-ar") return tokenizeArabic(text);
  return baseTokenize(text);
}

export function includesNormalized(haystack, needle) {
  return normalizeArabic(haystack).includes(normalizeArabic(needle));
}
