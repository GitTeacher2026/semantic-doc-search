import { tokenize } from "../bm25-search.js";
import { tokenizeForEngine } from "./arabic-text.js";

export class TFIDFIndex {
  constructor(chunks, engineId = "tfidf") {
    this.chunks = chunks;
    this.engineId = engineId;
    this.docTokens = chunks.map((chunk) =>
      tokenizeForEngine(engineId === "bm25-ar" ? "bm25-ar" : "tfidf", chunk.content)
    );
    this.nDocs = chunks.length;
    this.df = new Map();
    for (const tokens of this.docTokens) {
      for (const term of new Set(tokens)) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }
  }

  vectorForDoc(docIdx) {
    const tokens = this.docTokens[docIdx];
    const tf = new Map();
    for (const term of tokens) tf.set(term, (tf.get(term) || 0) + 1);
    const vector = new Map();
    for (const [term, freq] of tf.entries()) {
      const df = this.df.get(term) || 0;
      const idf = Math.log(1 + this.nDocs / (df + 1));
      vector.set(term, (freq / tokens.length) * idf);
    }
    return vector;
  }

  scoreDoc(queryTokens, docIdx) {
    const queryTf = new Map();
    for (const term of queryTokens) queryTf.set(term, (queryTf.get(term) || 0) + 1);
    const docVector = this.vectorForDoc(docIdx);
    let dot = 0;
    let queryNorm = 0;
    let docNorm = 0;

    for (const [term, qFreq] of queryTf.entries()) {
      const df = this.df.get(term) || 0;
      const idf = Math.log(1 + this.nDocs / (df + 1));
      const qWeight = (qFreq / queryTokens.length) * idf;
      const dWeight = docVector.get(term) || 0;
      dot += qWeight * dWeight;
      queryNorm += qWeight * qWeight;
    }
    for (const weight of docVector.values()) docNorm += weight * weight;

    const denom = Math.sqrt(queryNorm) * Math.sqrt(docNorm);
    return denom ? dot / denom : 0;
  }

  search(query, k = 5, category = null) {
    const queryTokens = tokenizeForEngine(
      this.engineId === "bm25-ar" ? "bm25-ar" : "tfidf",
      query
    );
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
