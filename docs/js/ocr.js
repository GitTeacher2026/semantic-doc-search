const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
]);

let workerPromise = null;

export function isImageFile(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import(
        "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js"
      );
      return createWorker("ara+eng", 1);
    })();
  }
  return workerPromise;
}

export async function extractImageText(file, onProgress) {
  const worker = await getWorker();
  const source = file instanceof Blob ? file : new Blob([file]);
  const { data } = await worker.recognize(source, {
    logger: (message) => {
      if (message.status === "recognizing text" && onProgress) {
        onProgress(Math.round((message.progress || 0) * 100));
      }
    },
  });
  const text = String(data?.text || "").replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("لم يُعثر على نص في الصورة. جرّب صورة أوضح أو بدقة أعلى.");
  }
  return text;
}
