import { BM25Index, tokenize } from "./bm25-search.js";
import { DEFAULT_SEARCH_OPTIONS } from "./search-options.js";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryTerms(query, options) {
  if (options.exactPhrase) {
    return [String(query || "").trim()].filter(Boolean);
  }
  if (options.wholeWords) {
    return String(query || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  return tokenize(query, { matchCase: options.matchCase });
}

function containsWholeTerm(text, term, matchCase) {
  const flags = matchCase ? "u" : "iu";
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegex(term)}([^\\p{L}\\p{N}_]|$)`,
    flags
  );
  return pattern.test(String(text || ""));
}

function textMatchesQuery(text, query, options) {
  const source = String(text || "");
  const trimmed = String(query || "").trim();
  if (!trimmed || !source) return false;

  if (options.exactPhrase) {
    return options.matchCase
      ? source.includes(trimmed)
      : source.toLowerCase().includes(trimmed.toLowerCase());
  }

  const terms = queryTerms(query, options);
  if (!terms.length) return false;

  return terms.every((term) => {
    if (options.wholeWords) {
      return containsWholeTerm(source, term, options.matchCase);
    }
    if (options.matchCase) {
      return source.includes(term);
    }
    return source.toLowerCase().includes(String(term).toLowerCase());
  });
}

function needsTextFilter(options) {
  return Boolean(options.matchCase || options.wholeWords || options.exactPhrase);
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

function toHit(chunk, score) {
  return {
    chunk,
    score,
    docId: chunk.docId,
    filename: chunk.filename,
    category: chunk.category,
    content: chunk.content,
  };
}

function rankHits(matches, query, options, limit) {
  if (!matches.length) return [];

  const index = new BM25Index(matches);
  const ranked = index.search(query, matches.length, null, {
    matchCase: options.matchCase,
  });

  const hits = ranked.length
    ? ranked
    : matches
        .map((chunk) => toHit(chunk, chunk.source === "filename" ? 2 : 1))
        .sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename, "ar"));

  return hits
    .filter((hit) => textMatchesQuery(hit.content, query, options))
    .slice(0, limit);
}

function textFilteredSearch(chunks, query, options, category, limit) {
  let pool = chunks;
  if (category) pool = pool.filter((chunk) => chunk.category === category);

  const matches = pool.filter((chunk) => textMatchesQuery(chunk.content, query, options));
  return rankHits(matches, query, options, limit);
}

function bm25Search(chunks, query, options, category, limit) {
  const index = new BM25Index(chunks);
  return index.search(query, limit, category, { matchCase: options.matchCase });
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

  if (needsTextFilter(options)) {
    return textFilteredSearch(chunks, trimmed, options, category, limit);
  }

  return bm25Search(chunks, trimmed, options, category, limit);
}
