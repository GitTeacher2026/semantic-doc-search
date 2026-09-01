import { STORE_PATH } from "./config.js";

export const LEGACY_STORE_USER_ID = "admin-default";

export function sanitizeUserId(userId) {
  const safe = String(userId || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(safe)) {
    throw new Error("معرّف المستخدم غير صالح للتخزين.");
  }
  return safe;
}

export function getGitHubStorePathForUser(userId) {
  return `data/stores/${sanitizeUserId(userId)}/browser-store.enc.json`;
}

export function getLegacyStorePath() {
  return STORE_PATH;
}

export function shouldTryLegacyStore(userId) {
  return sanitizeUserId(userId) === LEGACY_STORE_USER_ID;
}

export function localCacheKeyForUser(userId) {
  return `docshelf_store_v5_${sanitizeUserId(userId)}`;
}

export function scopeStateToUser(state, userId) {
  const ownerId = sanitizeUserId(userId);
  const isOwned = (doc) => !doc?.ownerId || doc.ownerId === ownerId;
  return {
    ...state,
    documents: (state.documents || []).filter(isOwned),
    trash: (state.trash || []).filter(isOwned),
  };
}

export function stampOwnerOnState(state, userId) {
  const ownerId = sanitizeUserId(userId);
  const stamp = (doc) => (doc?.ownerId ? doc : { ...doc, ownerId });
  return {
    ...state,
    documents: (state.documents || []).map(stamp),
    trash: (state.trash || []).map(stamp),
  };
}
