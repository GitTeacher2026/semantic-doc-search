import { BM25Index, tokenize } from "./bm25-search.js";
import { DEFAULT_SEARCH_OPTIONS } from "./search-options.js";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareToken(token, term, matchCase) {
  return matchCase ? token === term : token.toLowerCase() === term.toLowerCase();
}

function queryTerms(query, options) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  if (options.exactPhrase) {
    return [trimmed];
  }

  if (options.wholeWords) {
    const tokens = tokenize(trimmed, { matchCase: options.matchCase });
    if (tokens.length) return tokens;
    return trimmed.split(/\s+/).filter(Boolean);
  }

  return tokenize(trimmed, { matchCase: options.matchCase });
}

function sourceTokens(text, matchCase) {
  return tokenize(String(text || ""), { matchCase });
}

function containsWholeTerm(text, term, matchCase) {
  const tokens = sourceTokens(text, matchCase);
  return tokens.some((token) => compareToken(token, term, matchCase));
}

function containsTerm(text, term, matchCase) {
  const source = String(text || "");
  if (!term) return false;
  if (matchCase) return source.includes(term);
  return source.toLowerCase().includes(String(term).toLowerCase());
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
    return containsTerm(source, term, options.matchCase);
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

  if (options.exactPhrase) {
    return matches
      .map((chunk) => toHit(chunk, chunk.source === "filename" ? 3 : 2))
      .sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename, "ar"))
      .slice(0, limit);
  }

  const index = new BM25Index(matches);
  const ranked = index.search(query, matches.length, null, {
    matchCase: options.matchCase,
  });

  const hits = ranked.length
    ? ranked
    : matches
        .map((chunk) => toHit(chunk, chunk.source === "filename" ? 2 : 1))
        .sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename, "ar"));

  return hits.slice(0, limit);
}

function textFilteredSearch(chunks, query, options, category, limit) {
  let pool = chunks;
  if (category) pool = pool.filter((chunk) => chunk.category === category);
  const matches = pool.filter((chunk) => textMatchesQuery(chunk.content, query, options));
  return rankHits(matches, query, options, limit);
}

function bm25Search(chunks, query, options, category, limit) {
  const index = new BM25Index(chunks);
  const hits = index.search(query, limit, category, { matchCase: options.matchCase });
  if (hits.length) return hits;

  let pool = category ? chunks.filter((chunk) => chunk.category === category) : chunks;
  return pool
    .filter((chunk) => containsTerm(chunk.content, query, options.matchCase))
    .slice(0, limit)
    .map((chunk) => toHit(chunk, chunk.source === "filename" ? 2 : 1));
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
