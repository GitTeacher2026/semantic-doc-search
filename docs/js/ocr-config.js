import { OCR_SPACE_API_KEY } from "./config.js";

let cachedOcrSpaceKey = null;
let hydratePromise = null;

export async function hydrateOcrSpaceKey() {
  if (cachedOcrSpaceKey) return cachedOcrSpaceKey;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const imported = String(OCR_SPACE_API_KEY || "").trim();
    if (imported) {
      cachedOcrSpaceKey = imported;
      return cachedOcrSpaceKey;
    }

    try {
      const res = await fetch(`./js/config.js?cb=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        const match = text.match(/OCR_SPACE_API_KEY\s*=\s*"([^"]*)"/);
        cachedOcrSpaceKey = match?.[1]?.trim() || "";
      }
    } catch {
      cachedOcrSpaceKey = "";
    }

    return cachedOcrSpaceKey;
  })();

  return hydratePromise;
}

export function getOcrSpaceKeySync() {
  return cachedOcrSpaceKey || String(OCR_SPACE_API_KEY || "").trim();
}

export function isOcrSpaceConfigured() {
  return getOcrSpaceKeySync().length >= 8;
}
