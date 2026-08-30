/**
 * BM25 search in the browser — no ML model download required.
 */

export const STOPWORDS = new Set(
  `في من إلى عن على أن أو كان كانت هذا هذه ذلك تلك التي الذي الذين ما لم لن إن أنه إذا ثم قد لقد حيث عند بين حتى بعد قبل كل بعض أي نحو عبر حول خلال ضمن دون فوق تحت مستند ملف صفحة نص محتوى
  a an the and or but if in on at to for of with by from as is are was were be document file pdf txt`.split(/\s+/)
);

const K1 = 1.5;
const B = 0.75;
const CATEGORY_OVERLAP_THRESHOLD = 0.08;

const BROAD_TOPICS = [
  {
    label: "إدارة ومشاريع",
    keywords: ["مشروع", "إداري", "إدارة", "تقرير", "خطة", "اجتماع", "موظف", "project", "management", "plan"],
  },
  {
    label: "مالية ومحاسبة",
    keywords: ["مالي", "محاسبة", "ميزانية", "فاتورة", "تكلفة", "finance", "budget", "invoice", "accounting"],
  },
  {
    label: "قانون وعقود",
    keywords: ["قانون", "عقد", "legal", "contract", "اتفاقية", "محكمة", "قضية"],
  },
  {
    label: "هندسة وتقنية",
    keywords: ["هندسة", "تقني", "برمجة", "نظام", "engineering", "technical", "software", "تقنية"],
  },
  {
    label: "تعليم وبحث",
    keywords: ["تعليم", "دراسة", "بحث", "جامعة", "education", "research", "طالب", "منهج"],
  },
  {
    label: "صحة وطب",
    keywords: ["صحة", "طبي", "علاج", "health", "medical", "مستشفى", "دواء"],
  },
];

export function tokenize(text, { matchCase = false } = {}) {
  return (String(text || "").match(/[\u0600-\u06FF]{2,}|[a-z0-9]{2,}/gi) || [])
    .map((token) => (matchCase ? token : token.toLowerCase()))
    .filter((token) => !STOPWORDS.has(matchCase ? token.toLowerCase() : token));
}

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

function dominantToken(tokens) {
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

export function topicLabel(text, filename) {
  const tokens = tokenize(text);
  const broad = detectBroadTopic(tokens);
  if (broad) return broad;

  const mainToken = dominantToken(tokens);
  if (mainToken) return mainToken;

  const baseName = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (baseName.length >= 3) return baseName.slice(0, 32);

  return "عام";
}

function categorySimilarity(docTokens, categoryTokens) {
  let overlap = 0;
  for (const token of docTokens) {
    if (categoryTokens.has(token)) overlap += 1;
  }
  const union = new Set([...docTokens, ...categoryTokens]).size;
  return union ? overlap / union : 0;
}

function buildCategoryTokenMap(documents) {
  const byCategory = new Map();
  for (const doc of documents) {
    if (!byCategory.has(doc.category)) byCategory.set(doc.category, new Set());
    const bucket = byCategory.get(doc.category);
    for (const token of tokenize(doc.category)) bucket.add(token);
    const preview = doc.preview || doc.filename || "";
    for (const token of tokenize(preview.slice(0, 2000))) bucket.add(token);
  }
  return byCategory;
}

function findSimilarCategory(docTokens, documents) {
  const byCategory = buildCategoryTokenMap(documents);
  let bestCategory = null;
  let bestScore = 0;

  for (const [category, categoryTokens] of byCategory.entries()) {
    const score = categorySimilarity(docTokens, categoryTokens);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestCategory && bestScore >= CATEGORY_OVERLAP_THRESHOLD) return bestCategory;
  return null;
}

function mergeWithExistingLabel(label, documents) {
  for (const doc of documents) {
    const existing = doc.category;
    if (!existing) continue;
    if (existing === label) return existing;
    if (existing.includes(label) || label.includes(existing)) return existing;
  }
  return label;
}

export function assignCategory(text, filename, documents) {
  const docTokens = new Set(tokenize(text.slice(0, 4000) || filename));
  if (!docTokens.size) return topicLabel(text, filename);

  const similar = findSimilarCategory(docTokens, documents);
  if (similar) return similar;

  const candidate = topicLabel(text, filename);
  if (!documents.length) return candidate;

  const merged = mergeWithExistingLabel(candidate, documents);
  if (merged !== candidate) return merged;

  const broad = detectBroadTopic(docTokens);
  if (broad) {
    const broadMatch = documents.find((doc) => doc.category === broad);
    if (broadMatch) return broad;
    return broad;
  }

  return candidate;
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
      const denom = freq + K1 * (1 - B + B * (dl / this.avgdl));
      score += idf * ((freq * (K1 + 1)) / denom);
    }
    return score;
  }

  search(query, k = 5, category = null, options = {}) {
    const queryTokens = tokenize(query, { matchCase: Boolean(options.matchCase) });
    if (!queryTokens.length) return [];

    const hits = [];
    for (let idx = 0; idx < this.chunks.length; idx += 1) {
      const chunk = this.chunks[idx];
      if (category && chunk.category !== category) continue;
      const score = this.scoreDoc(queryTokens, idx);
      if (score > 0) hits.push({ chunk, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k).map(({ chunk, score }) => ({
      chunk,
      score,
      docId: chunk.docId,
      filename: chunk.filename,
      category: chunk.category,
      content: chunk.content,
    }));
  }
}

export function allChunksFromDocuments(documents) {
  const chunks = [];
  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      const content =
        typeof chunk === "string"
          ? chunk
          : chunk?.content ?? chunk?.text ?? "";
      if (!String(content).trim()) continue;
      chunks.push({
        docId: doc.id,
        filename: doc.filename || "مستند",
        category: doc.category || "عام",
        content: String(content),
      });
    }
  }
  return chunks;
}
