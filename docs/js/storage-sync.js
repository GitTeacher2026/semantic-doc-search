import { bytesToBase64, base64ToBytes } from "./crypto.js";
import { downloadMegaFile, uploadDocumentFile as uploadMegaDocumentFile } from "./mega-storage.js";
import { isMegaConnected } from "./mega-auth.js";
import { isGitHubStorageConfigured } from "./github-storage.js";
import { loadDocumentsForMode, saveDocumentsForMode } from "./storage.js";
import { normalizeState } from "./trash.js";
import { STORAGE_MODES } from "./storage-preference.js";

export function canSyncGitHubMega() {
  return isGitHubStorageConfigured() && isMegaConnected();
}

export function getDocumentSyncStatus(doc) {
  const hasGitHub = Boolean(doc?.fileData);
  const hasMega = Boolean(doc?.megaFileId);
  if (hasGitHub && hasMega) return "both";
  if (hasGitHub) return "github";
  if (hasMega) return "mega";
  return "other";
}

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
  return normalizeState({
    documents: mergeDocuments(normalized.flatMap((state) => state.documents)),
    trash: mergeDocuments(normalized.flatMap((state) => state.trash)),
    folders: mergeFolderRecords(...normalized.map((state) => state.folders)),
  });
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

export async function mirrorDocumentToGitHub(doc) {
  if (doc.fileData) return doc;
  const blob = await blobFromDocument(doc);
  if (!blob) {
    throw new Error(`لا يمكن نسخ «${doc.filename}» إلى GitHub — لا يوجد ملف قابل للقراءة.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return finalizeSyncedDocument({
    ...doc,
    fileData: bytesToBase64(bytes),
    syncGithubAt: new Date().toISOString(),
  });
}

export async function syncDocumentsGitHubMega(documents, { onProgress } = {}) {
  if (!canSyncGitHubMega()) {
    throw new Error("يلزم ضبط GitHub واتصال MEGA لتفعيل المزامنة.");
  }

  const updated = [];
  let mirroredToMega = 0;
  let mirroredToGitHub = 0;
  let skipped = 0;

  for (let index = 0; index < documents.length; index += 1) {
    const doc = documents[index];
    onProgress?.({
      index: index + 1,
      total: documents.length,
      filename: doc.filename,
    });

    const status = getDocumentSyncStatus(doc);
    if (status === "other") {
      skipped += 1;
      updated.push(doc);
      continue;
    }

    let next = { ...doc };
    if (status === "github" || status === "both") {
      if (!next.megaFileId) {
        next = await mirrorDocumentToMega(next);
        mirroredToMega += 1;
      }
    }
    if (status === "mega" || status === "both") {
      if (!next.fileData) {
        next = await mirrorDocumentToGitHub(next);
        mirroredToGitHub += 1;
      }
    }
    if (status === "both" && next.megaFileId && next.fileData) {
      skipped += 1;
    }
    updated.push(finalizeSyncedDocument(next));
  }

  return {
    documents: updated,
    mirroredToMega,
    mirroredToGitHub,
    skipped,
  };
}

export async function loadMergedGitHubMegaIndex(password) {
  const [github, mega] = await Promise.all([
    loadDocumentsForMode(password, STORAGE_MODES.GITHUB),
    loadDocumentsForMode(password, STORAGE_MODES.MEGA),
  ]);
  return {
    state: mergeDocumentStates(github.state, mega.state),
    github,
    mega,
  };
}

export async function saveMergedGitHubMegaIndex(password, state, handles) {
  const githubPayload = snapshotStateForMode(state, STORAGE_MODES.GITHUB);
  const megaPayload = snapshotStateForMode(state, STORAGE_MODES.MEGA);
  const githubResult = await saveDocumentsForMode(
    password,
    githubPayload,
    STORAGE_MODES.GITHUB,
    handles.github.handle,
    handles.github.crypto
  );
  const megaResult = await saveDocumentsForMode(
    password,
    megaPayload,
    STORAGE_MODES.MEGA,
    handles.mega.handle,
    handles.mega.crypto
  );
  return { github: githubResult, mega: megaResult };
}

export function describeSyncSummary({ mirroredToMega, mirroredToGitHub, skipped }) {
  const parts = [];
  if (mirroredToMega) parts.push(`${mirroredToMega} إلى MEGA`);
  if (mirroredToGitHub) parts.push(`${mirroredToGitHub} إلى GitHub`);
  if (!parts.length) return "كل الملفات المدعومة متزامنة بالفعل.";
  return `تمت المزامنة: ${parts.join(" · ")}${skipped ? ` · ${skipped} بدون تغيير` : ""}`;
}
