/**
 * BM25 search in the browser — no ML model download required.
 */

export const STOPWORDS = new Set(
  `في من إلى عن على أن أو كان كانت هذا هذه ذلك تلك التي الذي الذين ما لم لن إن أنه إذا ثم قد لقد حيث عند بين حتى بعد قبل كل بعض أي نحو عبر حول خلال ضمن دون فوق تحت مستند ملف صفحة نص محتوى
  a an the and or but if in on at to for of with by from as is are was were be document file pdf txt`.split(/\s+/)
);

const K1 = 1.5;
const B = 0.75;
const CATEGORY_OVERLAP_THRESHOLD = 0.12;

export function tokenize(text) {
  return (String(text || "").match(/[\u0600-\u06FF]{2,}|[a-z0-9]{2,}/gi) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => !STOPWORDS.has(token));
}

export function topicLabel(text, filename) {
  const tokens = tokenize(text);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  if (!top.length) {
    const baseName = String(filename || "").replace(/\.[^.]+$/, "");
    return baseName || "عام";
  }
  return top.join(" / ");
}

export function assignCategory(text, filename, documents) {
  const docTokens = new Set(tokenize(text.slice(0, 4000) || filename));
  if (!docTokens.size) return topicLabel(text, filename);

  const byCategory = new Map();
  for (const doc of documents) {
    const preview = doc.preview || doc.filename || "";
    if (!byCategory.has(doc.category)) byCategory.set(doc.category, new Set());
    for (const token of tokenize(preview.slice(0, 2000))) {
      byCategory.get(doc.category).add(token);
    }
  }

  let bestCategory = null;
  let bestScore = 0;
  for (const [category, catTokens] of byCategory.entries()) {
    if (!catTokens.size) continue;
    let overlap = 0;
    for (const token of docTokens) {
      if (catTokens.has(token)) overlap += 1;
    }
    const union = new Set([...docTokens, ...catTokens]).size;
    const score = overlap / union;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestCategory && bestScore >= CATEGORY_OVERLAP_THRESHOLD) return bestCategory;
  return topicLabel(text, filename);
}

export class BM25Index {
  constructor(chunks) {
    this.chunks = chunks;
    this.docTokens = chunks.map((chunk) => tokenize(chunk.content));
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

  scoreDoc(queryTokens, docIdx) {
    const tokens = this.docTokens[docIdx];
    if (!tokens.length) return 0;

    const dl = tokens.length;
    const tf = new Map();
    for (const term of tokens) tf.set(term, (tf.get(term) || 0) + 1);

    let score = 0;
    for (const term of queryTokens) {
      const freq = tf.get(term) || 0;
      if (!freq) continue;
      const df = this.df.get(term) || 0;
      const idf = Math.log(1 + (this.nDocs - df + 0.5) / (df + 0.5));
      const denom = freq + K1 * (1 - B + (B * dl) / this.avgdl);
      score += (idf * (freq * (K1 + 1))) / denom;
    }
    return score;
  }

  search(query, k = 5, category = null) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    const hits = [];
    for (let idx = 0; idx < this.chunks.length; idx += 1) {
      const chunk = this.chunks[idx];
      if (category && chunk.category !== category) continue;
      const score = this.scoreDoc(queryTokens, idx);
      if (score > 0) hits.push({ chunk, score });
    }

    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, k);
    const maxScore = top[0]?.score || 1;
    return top.map((hit) => ({
      ...hit.chunk,
      score: hit.score / maxScore,
      rawScore: hit.score,
    }));
  }
}

export function allChunksFromDocuments(documents) {
  const chunks = [];
  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      chunks.push({
        content: chunk.content,
        filename: doc.filename,
        category: doc.category,
        docId: doc.id,
      });
    }
  }
  return chunks;
}
