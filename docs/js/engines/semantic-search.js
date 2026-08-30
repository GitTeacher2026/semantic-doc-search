const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let embedderPromise = null;
let modelStatus = "idle";

export function getSemanticModelStatus() {
  return modelStatus;
}

async function loadEmbedder(onStatus) {
  if (embedderPromise) return embedderPromise;

  modelStatus = "loading";
  onStatus?.("جارٍ تحميل نموذج البحث الدلالي…");

  embedderPromise = (async () => {
    const { pipeline, env } = await import(
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm"
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const extractor = await pipeline("feature-extraction", MODEL_ID, {
      quantized: true,
    });
    modelStatus = "ready";
    onStatus?.("");
    return extractor;
  })().catch((error) => {
    modelStatus = "error";
    embedderPromise = null;
    throw error;
  });

  return embedderPromise;
}

async function embedTexts(extractor, texts) {
  const vectors = [];
  for (const text of texts) {
    const output = await extractor(text.slice(0, 512), {
      pooling: "mean",
      normalize: true,
    });
    vectors.push(Array.from(output.data));
  }
  return vectors;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function normalizeHits(hits) {
  if (!hits.length) return hits;
  const max = Math.max(...hits.map((hit) => hit.score), 1e-9);
  return hits.map((hit) => ({ ...hit, score: hit.score / max }));
}

export async function semanticSearch(chunks, query, k = 5, category = null, onStatus) {
  const filtered = category ? chunks.filter((chunk) => chunk.category === category) : chunks;
  if (!filtered.length) return [];

  const extractor = await loadEmbedder(onStatus);
  const texts = filtered.map((chunk) => chunk.content);
  const [queryVector, ...docVectors] = await embedTexts(extractor, [query, ...texts]);

  const hits = filtered.map((chunk, idx) => ({
    chunk,
    score: cosineSimilarity(queryVector, docVectors[idx]),
  }));

  hits.sort((a, b) => b.score - a.score);
  return normalizeHits(hits.filter((hit) => hit.score > 0).slice(0, k));
}
