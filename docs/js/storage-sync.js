import { bytesToBase64, base64ToBytes } from "./crypto.js";
import { downloadMegaFile, uploadDocumentFile as uploadMegaDocumentFile } from "./mega-storage.js";
import { isMegaConnected } from "./mega-auth.js";
import { isGitHubStorageConfigured } from "./github-storage.js";

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

export async function mirrorDocumentToMega(doc) {
  if (doc.megaFileId) return doc;
  const blob = await blobFromDocument(doc);
  if (!blob) {
    throw new Error(`لا يمكن نسخ «${doc.filename}» إلى MEGA — لا يوجد ملف قابل للقراءة.`);
  }
  const megaFileId = await uploadMegaDocumentFile(doc.category || "عام", doc.filename, blob);
  return { ...doc, megaFileId, syncMegaAt: new Date().toISOString() };
}

export async function mirrorDocumentToGitHub(doc) {
  if (doc.fileData) return doc;
  const blob = await blobFromDocument(doc);
  if (!blob) {
    throw new Error(`لا يمكن نسخ «${doc.filename}» إلى GitHub — لا يوجد ملف قابل للقراءة.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    ...doc,
    fileData: bytesToBase64(bytes),
    syncGithubAt: new Date().toISOString(),
  };
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
    if (status === "both") {
      skipped += 1;
    }
    updated.push(next);
  }

  return {
    documents: updated,
    mirroredToMega,
    mirroredToGitHub,
    skipped,
  };
}

export function describeSyncSummary({ mirroredToMega, mirroredToGitHub, skipped }) {
  const parts = [];
  if (mirroredToMega) parts.push(`${mirroredToMega} إلى MEGA`);
  if (mirroredToGitHub) parts.push(`${mirroredToGitHub} إلى GitHub`);
  if (!parts.length) return "كل الملفات المدعومة متزامنة بالفعل.";
  return `تمت المزامنة: ${parts.join(" · ")}${skipped ? ` · ${skipped} بدون تغيير` : ""}`;
}
