export const TRASH_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeState(state) {
  const next = state && typeof state === "object" ? state : {};
  return {
    documents: Array.isArray(next.documents) ? next.documents : [],
    trash: Array.isArray(next.trash) ? next.trash : [],
  };
}

export function purgeExpiredTrash(state) {
  const normalized = normalizeState(state);
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * MS_PER_DAY;
  const trash = [];
  for (const item of normalized.trash) {
    const deletedAt = Date.parse(item.deletedAt || "");
    if (!Number.isNaN(deletedAt) && deletedAt < cutoff) continue;
    trash.push(item);
  }
  return { ...normalized, trash };
}

export function daysUntilPurge(deletedAt) {
  const deletedMs = Date.parse(deletedAt || "");
  if (Number.isNaN(deletedMs)) return TRASH_RETENTION_DAYS;
  const purgeAt = deletedMs + TRASH_RETENTION_DAYS * MS_PER_DAY;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / MS_PER_DAY));
}

export function moveToTrash(state, docId) {
  const normalized = normalizeState(state);
  const doc = normalized.documents.find((item) => item.id === docId);
  if (!doc) return normalized;
  return {
    documents: normalized.documents.filter((item) => item.id !== docId),
    trash: [{ ...doc, deletedAt: new Date().toISOString() }, ...normalized.trash],
  };
}

export function restoreFromTrash(state, docId) {
  const normalized = normalizeState(state);
  const doc = normalized.trash.find((item) => item.id === docId);
  if (!doc) return normalized;
  const { deletedAt, ...restored } = doc;
  return {
    documents: [...normalized.documents, restored],
    trash: normalized.trash.filter((item) => item.id !== docId),
  };
}

export function permanentlyDelete(state, docId) {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    trash: normalized.trash.filter((item) => item.id !== docId),
  };
}

export function purgeAllTrash(state) {
  const normalized = normalizeState(state);
  return { ...normalized, trash: [] };
}
