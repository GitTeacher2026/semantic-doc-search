import { ensureOneDriveAccess, getStoredAccessToken, isOneDriveConfigured } from "./onedrive-auth.js";

const ROOT_FOLDER_NAME = "مخزن الوثائق";
const INDEX_FILE_NAME = "docshelf-index.enc.json";

let rootFolderId = null;
let indexFileId = null;
const folderCache = new Map();

export { isOneDriveConfigured } from "./onedrive-auth.js";

export function sanitizeFolderName(name) {
  return (
    String(name || "عام")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "عام"
  );
}

async function graphRequest(path, options = {}) {
  const token = getStoredAccessToken() || (await ensureOneDriveAccess({ interactive: false }));
  if (!token) {
    throw new Error("يلزم تسجيل الدخول إلى OneDrive أولاً.");
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
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
    throw new Error(err.error?.message || `OneDrive (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function findChildFolder(parentId, name) {
  const filter = encodeURIComponent(`name eq '${name.replace(/'/g, "''")}'`);
  const data = await graphRequest(
    `/me/drive/items/${parentId}/children?$filter=${filter}&$select=id,name,folder`
  );
  return data.value?.find((item) => item.folder) || null;
}

async function createFolder(parentId, name) {
  return graphRequest(`/me/drive/items/${parentId}/children`, {
    method: "POST",
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
}

async function getOrCreateFolder(parentId, name) {
  const cacheKey = `${parentId}:${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);
  let folder = await findChildFolder(parentId, name);
  if (!folder) folder = await createFolder(parentId, name);
  folderCache.set(cacheKey, folder.id);
  return folder.id;
}

export async function getRootFolderId() {
  if (rootFolderId) return rootFolderId;
  const root = await graphRequest("/me/drive/root?$select=id");
  rootFolderId = await getOrCreateFolder(root.id, ROOT_FOLDER_NAME);
  return rootFolderId;
}

async function findChildFile(parentId, name) {
  const filter = encodeURIComponent(`name eq '${name.replace(/'/g, "''")}'`);
  const data = await graphRequest(
    `/me/drive/items/${parentId}/children?$filter=${filter}&$select=id,name,file`
  );
  return data.value?.find((item) => item.file) || null;
}

async function uploadContent(itemId, blob) {
  await graphRequest(`/me/drive/items/${itemId}/content`, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });
}

export async function uploadDocumentFile(category, filename, blob) {
  const rootId = await getRootFolderId();
  const categoryId = await getOrCreateFolder(rootId, sanitizeFolderName(category));
  const safeName = String(filename || "document").replace(/[\\/:*?"<>|]/g, "_");
  const existing = await findChildFile(categoryId, safeName);

  if (existing?.id) {
    await uploadContent(existing.id, blob);
    return existing.id;
  }

  const created = await graphRequest(
    `/me/drive/items/${categoryId}:/${encodeURIComponent(safeName)}:/content`,
    {
      method: "PUT",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    }
  );
  return created.id;
}

export async function downloadOneDriveFile(fileId) {
  const token = getStoredAccessToken() || (await ensureOneDriveAccess({ interactive: false }));
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`تعذّر تنزيل الملف من OneDrive (${res.status})`);
  }
  return res.arrayBuffer();
}

export async function renameOneDriveFile(fileId, newName) {
  const safeName = String(newName || "document").replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!safeName) {
    throw new Error("اسم الملف غير صالح.");
  }
  await graphRequest(`/me/drive/items/${fileId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: safeName }),
  });
  return safeName;
}

export async function fetchEncryptedStore() {
  const rootId = await getRootFolderId();
  const existing = await findChildFile(rootId, INDEX_FILE_NAME);
  if (!existing?.id) {
    indexFileId = null;
    return { envelope: null, fileId: null };
  }

  indexFileId = existing.id;
  const buffer = await downloadOneDriveFile(existing.id);
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  return { envelope: JSON.parse(text), fileId: existing.id };
}

export async function uploadEncryptedStore(envelope, fileId = indexFileId) {
  const rootId = await getRootFolderId();
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });

  if (fileId) {
    await uploadContent(fileId, blob);
    indexFileId = fileId;
    return fileId;
  }

  const existing = await findChildFile(rootId, INDEX_FILE_NAME);
  if (existing?.id) {
    await uploadContent(existing.id, blob);
    indexFileId = existing.id;
    return existing.id;
  }

  const created = await graphRequest(
    `/me/drive/items/${rootId}:/${encodeURIComponent(INDEX_FILE_NAME)}:/content`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: blob,
    }
  );
  indexFileId = created.id;
  return created.id;
}
