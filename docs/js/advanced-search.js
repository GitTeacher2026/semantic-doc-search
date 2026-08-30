import { BM25Index, allChunksFromDocuments, tokenize } from "./bm25-search.js";
import { DEFAULT_SEARCH_OPTIONS } from "./search-options.js";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeComparable(text, matchCase) {
  return matchCase ? String(text || "") : String(text || "").toLowerCase();
}

function textMatchesQuery(text, query, options) {
  const haystack = normalizeComparable(text, options.matchCase);
  const needle = normalizeComparable(query, options.matchCase);
  if (!needle) return false;

  if (options.exactPhrase) {
    return haystack.includes(needle);
  }

  const terms = options.wholeWords
    ? needle.split(/\s+/).filter(Boolean)
    : tokenize(query, { matchCase: options.matchCase });

  if (!terms.length) return false;

  return terms.every((term) => {
    if (options.wholeWords) {
      const pattern = new RegExp(
        `(?:^|[\\s\\p{P}\\p{S}])${escapeRegex(term)}(?:$|[\\s\\p{P}\\p{S}])`,
        options.matchCase ? "u" : "iu"
      );
      return pattern.test(` ${haystack} `);
    }
    return haystack.includes(normalizeComparable(term, options.matchCase));
  });
}

function buildSearchChunks(documents, options) {
  const chunks = [];

  for (const doc of documents) {
    if (options.searchInContent) {
      for (const chunk of doc.chunks || []) {
        const content =
          typeof chunk === "string" ? chunk : chunk?.content ?? chunk?.text ?? "";
        if (!String(content).trim()) continue;
        chunks.push({
          docId: doc.id,
          filename: doc.filename || "مستند",
          category: doc.category || "عام",
          content: String(content),
          source: "content",
        });
      }
    }

    if (options.searchInFilename && doc.filename) {
      chunks.push({
        docId: doc.id,
        filename: doc.filename,
        category: doc.category || "عام",
        content: doc.filename,
        source: "filename",
      });
    }
  }

  return chunks;
}

function exactSearch(chunks, query, options, category, limit) {
  const hits = [];
  for (const chunk of chunks) {
    if (category && chunk.category !== category) continue;
    if (!textMatchesQuery(chunk.content, query, options)) continue;
    hits.push({
      chunk,
      score: chunk.source === "filename" ? 2 : 1,
      docId: chunk.docId,
      filename: chunk.filename,
      category: chunk.category,
      content: chunk.content,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename, "ar"));
  return hits.slice(0, limit);
}

function bm25Search(chunks, query, options, category, limit) {
  const index = new BM25Index(chunks);
  const hits = index.search(query, limit * 3, category, {
    matchCase: options.matchCase,
  });

  if (!options.wholeWords && !options.exactPhrase) {
    return hits.slice(0, limit);
  }

  return hits
    .filter((hit) => textMatchesQuery(hit.content, query, options))
    .slice(0, limit);
}

export function advancedSearch(documents, query, rawOptions = {}) {
  const options = { ...DEFAULT_SEARCH_OPTIONS, ...rawOptions };
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  if (!options.searchInContent && !options.searchInFilename) {
    return [];
  }

  const category = rawOptions.category || null;
  const limit = Number(rawOptions.limit) || 5;
  const chunks = buildSearchChunks(documents, options);
  if (!chunks.length) return [];

  if (options.exactPhrase) {
    return exactSearch(chunks, trimmed, options, category, limit);
  }

  return bm25Search(chunks, trimmed, options, category, limit);
}
