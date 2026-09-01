import { getMegaStorage } from "./mega-auth.js";
import { blobToUint8Array } from "./binary-utils.js";
import { sanitizeUserId } from "./user-storage-scope.js";

const ROOT_FOLDER_NAME = "مخزن الوثائق";
const INDEX_FILE_NAME = "docshelf-index.enc.json";

let rootFolder = null;
let indexFile = null;
const folderCache = new Map();
let megaUserScope = null;

export function setMegaUserScope(userId) {
  const next = userId ? sanitizeUserId(userId) : null;
  if (megaUserScope === next) return;
  megaUserScope = next;
  rootFolder = null;
  indexFile = null;
  folderCache.clear();
}

export function getMegaUserScope() {
  return megaUserScope;
}

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
  const appRoot = await getOrCreateChildFolder(storage.root, ROOT_FOLDER_NAME);
  if (!megaUserScope) {
    rootFolder = appRoot;
    return rootFolder;
  }
  rootFolder = await getOrCreateChildFolder(appRoot, megaUserScope);
  return rootFolder;
}

async function findChildFile(parent, name) {
  return (
    parent.find?.(name) ||
    parent.children?.find((item) => item.name === name && !item.directory) ||
    null
  );
}

function listChildFiles(parent, name) {
  const children = parent.children || [];
  return children.filter((item) => item.name === name && !item.directory);
}

async function deleteAllNamedFiles(parent, name) {
  const storage = getMegaStorage();
  const matches = listChildFiles(parent, name);
  for (const item of matches) {
    try {
      await item.delete(true);
    } catch {
      /* file may already be gone */
    }
  }
  for (const file of Object.values(storage.files || {})) {
    if (file.name !== name || file.directory) continue;
    try {
      await file.delete(true);
    } catch {
      /* ignore */
    }
  }
}

export async function deleteMegaFile(nodeId) {
  if (!nodeId) return;
  const storage = getMegaStorage();
  const file =
    storage.files?.[nodeId] ||
    Object.values(storage.files || {}).find((item) => item.nodeId === nodeId);
  if (!file) return;
  await file.delete(true);
}

function extractMegaNodeId(uploaded) {
  return uploaded?.nodeId || uploaded?.node?.nodeId || uploaded?.downloadId || null;
}

export async function uploadDocumentFile(category, filename, blob) {
  const root = await getRootFolder();
  const categoryFolder = await getOrCreateChildFolder(root, sanitizeFolderName(category));
  const safeName = String(filename || "document").replace(/[\\/:*?"<>|]/g, "_");
  const existing = await findChildFile(categoryFolder, safeName);
  if (existing) {
    await existing.delete(true);
  }

  const bytes = await blobToUint8Array(blob);
  const uploaded = await categoryFolder
    .upload(
      {
        name: safeName,
        size: bytes.byteLength,
      },
      bytes
    )
    .complete;
  const nodeId = extractMegaNodeId(uploaded);
  if (!nodeId) {
    throw new Error(`تعذّر الحصول على معرّف الملف في MEGA بعد رفع «${safeName}».`);
  }
  return nodeId;
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

export async function moveMegaFileToCategory(nodeId, filename, newCategory) {
  const buffer = await downloadMegaFile(nodeId);
  const blob = new Blob([new Uint8Array(buffer)]);
  const newId = await uploadDocumentFile(newCategory, filename, blob);
  try {
    const storage = getMegaStorage();
    const file =
      storage.files?.[nodeId] ||
      Object.values(storage.files || {}).find((item) => item.nodeId === nodeId);
    if (file) await file.delete(true);
  } catch {
    /* old file may already be gone */
  }
  return newId;
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
  const matches = listChildFiles(root, INDEX_FILE_NAME);
  if (!matches.length) {
    indexFile = null;
    return { envelope: null, fileId: null };
  }

  const existing = matches[matches.length - 1];
  indexFile = existing;
  const buffer = await existing.downloadBuffer();
  const text = new TextDecoder().decode(buffer);
  return { envelope: JSON.parse(text), fileId: existing.nodeId };
}

export async function uploadEncryptedStore(envelope, fileId = indexFile?.nodeId) {
  const root = await getRootFolder();
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));

  await deleteAllNamedFiles(root, INDEX_FILE_NAME);
  if (fileId) {
    try {
      await deleteMegaFile(fileId);
    } catch {
      /* ignore stale handle */
    }
  }

  const uploaded = await root
    .upload(
      {
        name: INDEX_FILE_NAME,
        size: bytes.byteLength,
      },
      bytes
    )
    .complete;
  indexFile = uploaded;
  return extractMegaNodeId(uploaded) || uploaded?.nodeId || null;
}
