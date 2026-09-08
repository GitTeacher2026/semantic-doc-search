import { ensurePuterConnected } from "./puter-auth.js";

const CHUNK_CHARS = 3500;

function extractChatText(response) {
  if (response == null) return "";
  if (typeof response === "string") return response.trim();
  if (typeof response?.message === "string") return response.message.trim();
  if (typeof response?.text === "string") return response.text.trim();
  const content = response?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return String(response).trim();
}

async function translateChunk(puter, text, { onStatus } = {}) {
  const prompt = [
    "You are a professional pharmaceutical translator.",
    "Translate the following Summary of Product Characteristics (SmPC) excerpt from English to Modern Standard Arabic.",
    "Keep section headings meaning, medical terminology accurate, and numbers/units unchanged.",
    "Output ONLY the Arabic translation — no preface or notes.",
    "",
    text,
  ].join("\n");

  onStatus?.("جارٍ الترجمة عبر Puter AI…");
  const response = await puter.ai.chat(prompt, { model: "gpt-5.4-nano" });
  const translated = extractChatText(response);
  if (!translated) throw new Error("تعذّر الحصول على ترجمة من Puter AI.");
  return translated;
}

function chunkText(text, size = CHUNK_CHARS) {
  const source = String(text || "");
  if (source.length <= size) return [source];
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + size);
    if (end < source.length) {
      const breakAt = source.lastIndexOf("\n\n", end);
      if (breakAt > start + size * 0.5) end = breakAt;
    }
    parts.push(source.slice(start, end).trim());
    start = end;
  }
  return parts.filter(Boolean);
}

export async function translateSmpcSections(sections, { onStatus } = {}) {
  const puter = await ensurePuterConnected();
  const translated = [];

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    onStatus?.(`ترجمة القسم ${i + 1} من ${sections.length}: ${section.title}`);
    const bodyChunks = chunkText(section.text);
    const arabicBodies = [];
    for (let c = 0; c < bodyChunks.length; c += 1) {
      if (bodyChunks.length > 1) {
        onStatus?.(`ترجمة القسم ${i + 1}/${sections.length} — جزء ${c + 1}/${bodyChunks.length}`);
      }
      arabicBodies.push(await translateChunk(puter, `${section.title}\n\n${bodyChunks[c]}`, { onStatus }));
    }

    let arabicTitle = section.title;
    try {
      arabicTitle = await translateChunk(
        puter,
        `Translate this SmPC section heading to Arabic. Output only the heading:\n${section.title}`,
        { onStatus }
      );
    } catch {
      /* keep English heading */
    }

    translated.push({
      key: section.key,
      title: arabicTitle.replace(/^#+\s*/, "").trim() || section.title,
      text: arabicBodies.join("\n\n").trim(),
    });
  }

  return translated;
}

export async function translatePlainText(text, { onStatus } = {}) {
  const puter = await ensurePuterConnected();
  const chunks = chunkText(text);
  const out = [];
  for (let i = 0; i < chunks.length; i += 1) {
    onStatus?.(`ترجمة النص… (${i + 1}/${chunks.length})`);
    out.push(await translateChunk(puter, chunks[i], { onStatus }));
  }
  return out.join("\n\n");
}
