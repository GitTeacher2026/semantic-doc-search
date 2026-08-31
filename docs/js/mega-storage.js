import { getMegaStorage } from "./mega-auth.js";

const ROOT_FOLDER_NAME = "مخزن الوثائق";
const INDEX_FILE_NAME = "docshelf-index.enc.json";

let rootFolder = null;
let indexFile = null;
const folderCache = new Map();

export function sanitizeFolderName(name) {
  return (
    String(name || "عام")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "عام"
  );
}

async function getOrCreateChildFolder(parent, name) {
  const cacheKey = `${parent.nodeId || "root"}:${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  let child =
    parent.find?.(name) ||
    parent.children?.find((item) => item.name === name && item.directory);
  if (!child) {
    child = await parent.mkdir(name);
  }
  folderCache.set(cacheKey, child);
  return child;
}

export async function getRootFolder() {
  if (rootFolder) return rootFolder;
  const storage = getMegaStorage();
  rootFolder = await getOrCreateChildFolder(storage.root, ROOT_FOLDER_NAME);
  return rootFolder;
}

async function findChildFile(parent, name) {
  return (
    parent.find?.(name) ||
    parent.children?.find((item) => item.name === name && !item.directory) ||
    null
  );
}

export async function uploadDocumentFile(category, filename, blob) {
  const root = await getRootFolder();
  const categoryFolder = await getOrCreateChildFolder(root, sanitizeFolderName(category));
  const safeName = String(filename || "document").replace(/[\\/:*?"<>|]/g, "_");
  const existing = await findChildFile(categoryFolder, safeName);
  if (existing) {
    await existing.delete(true);
  }

  const uploaded = await categoryFolder
    .upload(
      {
        name: safeName,
        size: blob.size,
      },
      blob
    )
    .complete;
  return uploaded.nodeId;
}

export async function downloadMegaFile(nodeId) {
  const storage = getMegaStorage();
  const file =
    storage.files?.[nodeId] ||
    Object.values(storage.files || {}).find((item) => item.nodeId === nodeId);
  if (!file) {
    throw new Error("تعذّر العثور على الملف في MEGA.");
  }
  const data = await file.downloadBuffer();
  return data.buffer || data;
}

export async function renameMegaFile(nodeId, newName) {
  const storage = getMegaStorage();
  const file =
    storage.files?.[nodeId] ||
    Object.values(storage.files || {}).find((item) => item.nodeId === nodeId);
  if (!file) {
    throw new Error("تعذّر العثور على الملف في MEGA.");
  }
  const safeName = String(newName || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!safeName) {
    throw new Error("اسم الملف غير صالح.");
  }
  await file.rename(safeName);
  return safeName;
}

export async function fetchEncryptedStore() {
  const root = await getRootFolder();
  const existing = await findChildFile(root, INDEX_FILE_NAME);
  if (!existing) {
    indexFile = null;
    return { envelope: null, fileId: null };
  }

  indexFile = existing;
  const buffer = await existing.downloadBuffer();
  const text = new TextDecoder().decode(buffer);
  return { envelope: JSON.parse(text), fileId: existing.nodeId };
}

export async function uploadEncryptedStore(envelope, fileId = indexFile?.nodeId) {
  const root = await getRootFolder();
  const payload = JSON.stringify(envelope);
  const blob = new Blob([payload], { type: "application/json" });

  if (fileId) {
    const storage = getMegaStorage();
    const existing =
      storage.files?.[fileId] ||
      Object.values(storage.files || {}).find((item) => item.nodeId === fileId);
    if (existing) {
      await existing.delete(true);
    }
  } else {
    const found = await findChildFile(root, INDEX_FILE_NAME);
    if (found) {
      await found.delete(true);
    }
  }

  const uploaded = await root
    .upload(
      {
        name: INDEX_FILE_NAME,
        size: blob.size,
      },
      blob
    )
    .complete;
  indexFile = uploaded;
  return uploaded.nodeId;
}
