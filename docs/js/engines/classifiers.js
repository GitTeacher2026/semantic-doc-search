import {
  assignCategory as keywordOverlapCategory,
  topicLabel,
  tokenize,
  BROAD_TOPICS,
} from "../bm25-search.js";
import { normalizeArabic } from "./arabic-text.js";

function detectBroadTopic(tokens) {
  const tokenList = [...tokens];
  let bestLabel = null;
  let bestScore = 0;
  for (const topic of BROAD_TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (tokenList.includes(keyword)) score += 2;
      else if (tokenList.some((token) => token.includes(keyword) || keyword.includes(token))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLabel = topic.label;
    }
  }
  return bestScore > 0 ? bestLabel : null;
}

function dominantTerm(text) {
  const tokens = tokenize(text);
  const counts = new Map();
  for (const token of tokens) {
    if (token.length < 3) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length
  );
  return ranked[0]?.[0] || null;
}

function categoryFromFilename(filename) {
  const base = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base.slice(0, 40) || "عام";
}

function categoryFromFirstLine(text) {
  const line = String(text || "")
    .split(/\n+/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "عام";
  const cleaned = line.replace(/\s+/g, " ").slice(0, 48);
  return cleaned.length >= 3 ? cleaned : "عام";
}

export function classifyDocument(engineId, text, filename, documents) {
  switch (engineId) {
    case "broad-topics": {
      const broad = detectBroadTopic(new Set(tokenize(text.slice(0, 4000))));
      if (broad) {
        const existing = documents.find((doc) => doc.category === broad);
        if (existing) return broad;
        return broad;
      }
      return topicLabel(text, filename);
    }
    case "dominant-term":
      return dominantTerm(text.slice(0, 4000)) || categoryFromFilename(filename) || "عام";
    case "filename":
      return categoryFromFilename(filename);
    case "first-line":
      return categoryFromFirstLine(text);
    case "keyword-overlap":
    default:
      return keywordOverlapCategory(text, filename, documents);
  }
}

export function previewText(text) {
  return normalizeArabic(text).replace(/\s+/g, " ").slice(0, 280);
}
