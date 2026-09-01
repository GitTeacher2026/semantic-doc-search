export const TRASH_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

export function normalizeState(state) {
  const next = state && typeof state === "object" ? state : {};
  const purgedDocumentIds = uniqueIds(next.purgedDocumentIds);
  const purged = new Set(purgedDocumentIds);
  const keepDoc = (doc) => doc?.id && !purged.has(doc.id);

  return {
    documents: (Array.isArray(next.documents) ? next.documents : []).filter(keepDoc),
    trash: (Array.isArray(next.trash) ? next.trash : []).filter(keepDoc),
    folders: Array.isArray(next.folders) ? next.folders : [],
    purgedDocumentIds,
  };
}

export function markDocumentsPurged(state, docIds = []) {
  const normalized = normalizeState(state);
  const purgedDocumentIds = uniqueIds([...normalized.purgedDocumentIds, ...docIds]);
  const purged = new Set(purgedDocumentIds);

  return {
    ...normalized,
    purgedDocumentIds,
    documents: normalized.documents.filter((doc) => !purged.has(doc.id)),
    trash: normalized.trash.filter((doc) => !purged.has(doc.id)),
  };
}

export function purgeExpiredTrash(state) {
  const normalized = normalizeState(state);
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * MS_PER_DAY;
  const expiredIds = [];
  const trash = [];

  for (const item of normalized.trash) {
    const deletedAt = Date.parse(item.deletedAt || "");
    if (!Number.isNaN(deletedAt) && deletedAt < cutoff) {
      if (item.id) expiredIds.push(item.id);
      continue;
    }
    trash.push(item);
  }

  if (!expiredIds.length) {
    return { ...normalized, trash };
  }

  return markDocumentsPurged({ ...normalized, trash }, expiredIds);
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
    ...normalized,
    documents: normalized.documents.filter((item) => item.id !== docId),
    trash: [
      { ...doc, deletedAt: new Date().toISOString() },
      ...normalized.trash.filter((item) => item.id !== docId),
    ],
  };
}

export function restoreFromTrash(state, docId) {
  const normalized = normalizeState(state);
  const doc = normalized.trash.find((item) => item.id === docId);
  if (!doc) return normalized;

  const { deletedAt, ...restored } = doc;
  const purgedDocumentIds = normalized.purgedDocumentIds.filter((id) => id !== docId);

  return {
    ...normalized,
    purgedDocumentIds,
    documents: [...normalized.documents.filter((item) => item.id !== docId), restored],
    trash: normalized.trash.filter((item) => item.id !== docId),
  };
}

export function permanentlyDelete(state, docId) {
  return markDocumentsPurged(state, [docId]);
}

export function purgeAllTrash(state) {
  const normalized = normalizeState(state);
  const ids = normalized.trash.map((doc) => doc.id).filter(Boolean);
  return markDocumentsPurged(normalized, ids);
}
