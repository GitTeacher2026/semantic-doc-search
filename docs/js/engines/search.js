import { BM25Index } from "../bm25-search.js";
import { tokenizeForEngine } from "./arabic-text.js";
import { SEARCH_ENGINES } from "./registry.js";
import { semanticSearch } from "./semantic-search.js";
import { substringSearch } from "./substring-search.js";
import { TFIDFIndex } from "./tfidf-search.js";

function normalizeHits(hits) {
  if (!hits.length) return hits;
  const max = Math.max(...hits.map((hit) => hit.score), 1e-9);
  return hits.map((hit) => ({
    ...hit,
    score: hit.score / max,
    filename: hit.chunk.filename,
    category: hit.chunk.category,
    docId: hit.chunk.docId,
    content: hit.chunk.content,
  }));
}

function bm25Search(engineId, chunks, query, k, category) {
  if (engineId === "bm25-ar") {
    const index = new ArabicBM25Index(chunks);
    return index.search(query, k, category);
  }
  const index = new BM25Index(chunks);
  return index.search(query, k, category);
}

class ArabicBM25Index extends BM25Index {
  constructor(chunks) {
    super(chunks);
    this.docTokens = chunks.map((chunk) => tokenizeForEngine("bm25-ar", chunk.content));
    this.nDocs = chunks.length;
    this.avgdl =
      this.docTokens.reduce((sum, tokens) => sum + tokens.length, 0) / (this.nDocs || 1);
    this.df = new Map();
    for (const tokens of this.docTokens) {
      for (const term of new Set(tokens)) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }
  }

  search(query, k = 5, category = null) {
    const queryTokens = tokenizeForEngine("bm25-ar", query);
    if (!queryTokens.length) return [];

    const hits = [];
    for (let idx = 0; idx < this.chunks.length; idx += 1) {
      const chunk = this.chunks[idx];
      if (category && chunk.category !== category) continue;
      const score = this.scoreDoc(queryTokens, idx);
      if (score > 0) hits.push({ chunk, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}

function mergeRankedLists(lists, weights, k) {
  const scores = new Map();
  for (let listIdx = 0; listIdx < lists.length; listIdx += 1) {
    const weight = weights[listIdx] || 1;
    const normalized = normalizeHits(lists[listIdx]);
    for (const hit of normalized) {
      const key = `${hit.chunk.docId}::${hit.chunk.content.slice(0, 80)}`;
      const prev = scores.get(key) || { chunk: hit.chunk, score: 0 };
      prev.score += hit.score * weight;
      scores.set(key, prev);
    }
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((hit) => ({ chunk: hit.chunk, score: hit.score }));
}

export async function runDocumentSearch({
  engineId,
  query,
  chunks,
  k = 5,
  category = null,
  onStatus,
}) {
  const engine = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.bm25;
  let hits = [];

  switch (engine.id) {
    case "bm25":
    case "bm25-ar":
      hits = bm25Search(engine.id, chunks, query, k, category);
      break;
    case "tfidf": {
      const index = new TFIDFIndex(chunks);
      hits = index.search(query, k, category);
      break;
    }
    case "substring":
      hits = substringSearch(chunks, query, k, category);
      break;
    case "semantic":
      hits = await semanticSearch(chunks, query, k, category, onStatus);
      return hits.map((hit) => ({
        ...hit,
        filename: hit.chunk.filename,
        category: hit.chunk.category,
        docId: hit.chunk.docId,
        content: hit.chunk.content,
      }));
    case "hybrid-lite":
      hits = mergeRankedLists(
        [
          bm25Search("bm25", chunks, query, k * 2, category),
          new TFIDFIndex(chunks).search(query, k * 2, category),
        ],
        [0.55, 0.45],
        k
      );
      break;
    case "hybrid": {
      const lexical = bm25Search("bm25", chunks, query, k * 2, category);
      const semantic = await semanticSearch(chunks, query, k * 2, category, onStatus);
      hits = mergeRankedLists([lexical, semantic], [0.5, 0.5], k);
      break;
    }
    default:
      hits = bm25Search("bm25", chunks, query, k, category);
  }

  return normalizeHits(hits);
}

export function engineNeedsModel(engineId) {
  return Boolean(SEARCH_ENGINES[engineId]?.needsModel);
}
