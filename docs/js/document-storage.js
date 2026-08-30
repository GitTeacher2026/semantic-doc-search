import { GITHUB_REPO, GITHUB_OWNER } from "./config.js";
import { STORAGE_MODES, getResolvedStorageMode } from "./storage-preference.js";

export const STORAGE_BACKENDS = {
  GITHUB: "github",
  DRIVE: "drive",
  LOCAL: "local",
};

export function inferDocumentStorage(doc) {
  if (doc?.storageBackend) return doc.storageBackend;
  if (doc?.driveFileId) return STORAGE_BACKENDS.DRIVE;
  if (doc?.fileData) return STORAGE_BACKENDS.GITHUB;
  return STORAGE_BACKENDS.LOCAL;
}

export function getActiveStorageBackend() {
  const mode = getResolvedStorageMode();
  if (mode === STORAGE_MODES.DRIVE) return STORAGE_BACKENDS.DRIVE;
  if (mode === STORAGE_MODES.GITHUB) return STORAGE_BACKENDS.GITHUB;
  return STORAGE_BACKENDS.LOCAL;
}

export function getStorageBackendLabel(backend) {
  if (backend === STORAGE_BACKENDS.DRIVE) return "Google Drive";
  if (backend === STORAGE_BACKENDS.GITHUB) return "GitHub";
  return "محلي";
}

export function getStorageBackendIcon(backend) {
  if (backend === STORAGE_BACKENDS.DRIVE) return "☁️";
  if (backend === STORAGE_BACKENDS.GITHUB) return "🐙";
  return "💾";
}

export function getDocumentStoragePath(doc) {
  const backend = inferDocumentStorage(doc);
  const category = doc.category || "عام";
  const filename = doc.filename || "مستند";

  if (backend === STORAGE_BACKENDS.DRIVE) {
    return `مخزن الوثائق / ${category} / ${filename}`;
  }
  if (backend === STORAGE_BACKENDS.GITHUB) {
    const repo = GITHUB_OWNER && GITHUB_REPO ? `${GITHUB_OWNER}/${GITHUB_REPO}` : "المستودع";
    return `${repo} / data / ${category} / ${filename}`;
  }
  return `محلي / ${category} / ${filename}`;
}

export function documentMatchesActiveStorage(doc, { showAll = false } = {}) {
  if (showAll) return true;
  return inferDocumentStorage(doc) === getActiveStorageBackend();
}
