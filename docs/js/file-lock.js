import { bytesToBase64 } from "./crypto.js";

const unlockedDocIds = new Set();
const unlockedFolderNames = new Set();

export function isFolderUnlocked(folderName) {
  if (!folderName) return true;
  return unlockedFolderNames.has(folderName);
}

export function unlockFolder(folderName) {
  if (folderName) unlockedFolderNames.add(folderName);
}

export function lockFolderSession(folderName) {
  if (folderName) unlockedFolderNames.delete(folderName);
}

export function isFolderAccessible(folder, folderName = folder?.name) {
  if (!folder?.isLocked) return true;
  return isFolderUnlocked(folderName || folder?.name);
}

export async function hashPassword(password) {
  const data = new TextEncoder().encode(String(password || ""));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(hash));
}

export function isDocUnlocked(doc) {
  if (!doc?.isLocked) return true;
  return unlockedDocIds.has(doc.id);
}

export function unlockDoc(docId) {
  unlockedDocIds.add(docId);
}

export function lockDocSession(docId) {
  unlockedDocIds.delete(docId);
}

export function clearUnlockSession() {
  unlockedDocIds.clear();
  unlockedFolderNames.clear();
}

export async function verifyLockPassword(doc, password) {
  if (!doc?.lockHash) return false;
  const hash = await hashPassword(password);
  return hash === doc.lockHash;
}

export function accessibleDocuments(documents) {
  return documents.filter((doc) => isDocUnlocked(doc));
}
