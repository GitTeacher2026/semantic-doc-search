import { ensureDriveAccess, getStoredAccessToken, isDriveConfigured } from "./drive-auth.js";

const ROOT_FOLDER_NAME = "مخزن الوثائق";
const INDEX_FILE_NAME = "docshelf-index.enc.json";

let rootFolderId = null;
let indexFileId = null;
const folderCache = new Map();

export { isDriveConfigured };

export function isDriveStorageConfigured() {
  return isDriveConfigured();
}

function escapeDriveQuery(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

async function driveJson(path, options = {}) {
  const token = getStoredAccessToken() || (await ensureDriveAccess());
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !options.headers?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Google Drive (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function findChildFolder(parentId, name) {
  const q = [
    `name='${escapeDriveQuery(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ");
  const data = await driveJson(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`
  );
  return data.files?.[0]?.id || null;
}

async function createFolder(parentId, name) {
  const data = await driveJson("/files", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return data.id;
}

async function getOrCreateFolder(parentId, name) {
  const cacheKey = `${parentId}:${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  let id = await findChildFolder(parentId, name);
  if (!id) id = await createFolder(parentId, name);
  folderCache.set(cacheKey, id);
  return id;
}

export async function getRootFolderId() {
  if (rootFolderId) return rootFolderId;
  rootFolderId = await getOrCreateFolder("root", ROOT_FOLDER_NAME);
  return rootFolderId;
}

async function findChildFile(parentId, name) {
  const q = [
    `name='${escapeDriveQuery(name)}'`,
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ");
  const data = await driveJson(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`
  );
  return data.files?.[0] || null;
}

async function uploadBinary(fileId, blob) {
  const token = getStoredAccessToken() || (await ensureDriveAccess());
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `تعذّر رفع الملف إلى Drive (${res.status})`);
  }
  return res.json();
}

export async function uploadDocumentFile(category, filename, blob) {
  const rootId = await getRootFolderId();
  const categoryId = await getOrCreateFolder(rootId, sanitizeFolderName(category));
  const safeName = String(filename || "document").replace(/[\\/:*?"<>|]/g, "_");
  const existing = await findChildFile(categoryId, safeName);

  if (existing?.id) {
    await uploadBinary(existing.id, blob);
    return existing.id;
  }

  const created = await driveJson("/files", {
    method: "POST",
    body: JSON.stringify({
      name: safeName,
      parents: [categoryId],
    }),
  });
  await uploadBinary(created.id, blob);
  return created.id;
}

export async function downloadDriveFile(fileId) {
  const token = getStoredAccessToken() || (await ensureDriveAccess());
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`تعذّر تنزيل الملف من Drive (${res.status})`);
  }
  return res.arrayBuffer();
}

export async function fetchEncryptedStore() {
  const rootId = await getRootFolderId();
  const existing = await findChildFile(rootId, INDEX_FILE_NAME);
  if (!existing?.id) {
    indexFileId = null;
    return { envelope: null, fileId: null };
  }

  indexFileId = existing.id;
  const buffer = await downloadDriveFile(existing.id);
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  return { envelope: JSON.parse(text), fileId: existing.id };
}

export async function uploadEncryptedStore(envelope, fileId = indexFileId) {
  const rootId = await getRootFolderId();
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });

  if (fileId) {
    await uploadBinary(fileId, blob);
    indexFileId = fileId;
    return fileId;
  }

  const existing = await findChildFile(rootId, INDEX_FILE_NAME);
  if (existing?.id) {
    await uploadBinary(existing.id, blob);
    indexFileId = existing.id;
    return existing.id;
  }

  const created = await driveJson("/files", {
    method: "POST",
    body: JSON.stringify({
      name: INDEX_FILE_NAME,
      parents: [rootId],
    }),
  });
  await uploadBinary(created.id, blob);
  indexFileId = created.id;
  return created.id;
}
