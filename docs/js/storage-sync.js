import { base64ToBytes } from "./crypto.js";
import { downloadMegaFile, uploadDocumentFile as uploadMegaDocumentFile } from "./mega-storage.js";
import { normalizeState } from "./trash.js";
import { STORAGE_MODES } from "./storage-preference.js";

function documentMergeKey(doc) {
  if (doc?.id) return `id:${doc.id}`;
  return `name:${doc.category || "عام"}::${doc.filename || ""}`;
}

function mergeDocumentPair(left, right) {
  const merged = { ...left, ...right };
  merged.fileData = left.fileData || right.fileData;
  merged.megaFileId = left.megaFileId || right.megaFileId;
  merged.driveFileId = left.driveFileId || right.driveFileId;
  merged.onedriveFileId = left.onedriveFileId || right.onedriveFileId;
  merged.chunks =
    (left.chunks?.length || 0) >= (right.chunks?.length || 0) ? left.chunks : right.chunks;
  merged.charCount = Math.max(left.charCount || 0, right.charCount || 0);
  if (merged.preview && !right.preview) merged.preview = left.preview;
  if (merged.fileData && merged.megaFileId) {
    delete merged.storageBackend;
  }
  return merged;
}

function mergeDocuments(documents = []) {
  const map = new Map();
  for (const doc of documents) {
    const key = documentMergeKey(doc);
    const existing = map.get(key);
    map.set(key, existing ? mergeDocumentPair(existing, doc) : { ...doc });
  }
  return [...map.values()];
}

function mergeFolderRecords(left = [], right = []) {
  const map = new Map();
  for (const folder of [...left, ...right]) {
    const name = folder?.name;
    if (!name) continue;
    const existing = map.get(name);
    if (!existing) {
      map.set(name, { ...folder });
      continue;
    }
    map.set(name, {
      ...existing,
      ...folder,
      isLocked: Boolean(existing.isLocked || folder.isLocked),
      lockHash: existing.lockHash || folder.lockHash || null,
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function mergeDocumentStates(...states) {
  const normalized = states.map((state) => normalizeState(state));
  const purgedDocumentIds = uniqueIds(normalized.flatMap((state) => state.purgedDocumentIds));

  return normalizeState({
    documents: mergeDocuments(normalized.flatMap((state) => state.documents)),
    trash: mergeDocuments(normalized.flatMap((state) => state.trash)),
    folders: mergeFolderRecords(...normalized.map((state) => state.folders)),
    purgedDocumentIds,
  });
}

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

function stripEmbeddedFileData(state) {
  const payload = normalizeState(state);
  const stripDoc = (doc) => {
    if (!doc?.fileData || !doc?.megaFileId) return doc;
    const { fileData, ...rest } = doc;
    return rest;
  };
  return {
    ...payload,
    documents: payload.documents.map(stripDoc),
    trash: payload.trash.map(stripDoc),
  };
}

export function snapshotStateForMode(state, mode) {
  if (mode === STORAGE_MODES.MEGA) {
    return stripEmbeddedFileData(state);
  }
  return normalizeState(state);
}

async function blobFromDocument(doc) {
  if (doc.fileData) {
    return new Blob([base64ToBytes(doc.fileData)]);
  }
  if (doc.megaFileId) {
    const buffer = await downloadMegaFile(doc.megaFileId);
    return new Blob([new Uint8Array(buffer)]);
  }
  return null;
}

function finalizeSyncedDocument(doc) {
  const next = { ...doc };
  if (next.fileData && next.megaFileId) {
    delete next.storageBackend;
  }
  return next;
}

export async function mirrorDocumentToMega(doc) {
  if (doc.megaFileId) return doc;
  const blob = await blobFromDocument(doc);
  if (!blob) {
    throw new Error(`لا يمكن نسخ «${doc.filename}» إلى MEGA — لا يوجد ملف قابل للقراءة.`);
  }
  const megaFileId = await uploadMegaDocumentFile(doc.category || "عام", doc.filename, blob);
  return finalizeSyncedDocument({
    ...doc,
    megaFileId,
    syncMegaAt: new Date().toISOString(),
  });
}
