import { bytesToBase64 } from "./crypto.js";

const unlockedDocIds = new Set();

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
}

export async function verifyLockPassword(doc, password) {
  if (!doc?.lockHash) return false;
  const hash = await hashPassword(password);
  return hash === doc.lockHash;
}

export function accessibleDocuments(documents) {
  return documents.filter((doc) => isDocUnlocked(doc));
}
