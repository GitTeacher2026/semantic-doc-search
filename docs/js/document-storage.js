import { GITHUB_REPO, GITHUB_OWNER } from "./config.js";
import { STORAGE_MODES, getResolvedStorageMode } from "./storage-preference.js";

export const STORAGE_BACKENDS = {
  GITHUB: "github",
  DRIVE: "drive",
  MEGA: "mega",
  ONEDRIVE: "onedrive",
  LOCAL: "local",
};

export function inferDocumentStorage(doc) {
  const backends = listDocumentStorageBackends(doc);
  if (backends.length === 1) return backends[0];
  if (backends.includes(STORAGE_BACKENDS.GITHUB) && backends.includes(STORAGE_BACKENDS.MEGA)) {
    return STORAGE_BACKENDS.GITHUB;
  }
  return backends[0] || STORAGE_BACKENDS.LOCAL;
}

export function listDocumentStorageBackends(doc) {
  const backends = [];
  if (doc?.fileData) backends.push(STORAGE_BACKENDS.GITHUB);
  if (doc?.megaFileId) backends.push(STORAGE_BACKENDS.MEGA);
  if (doc?.driveFileId) backends.push(STORAGE_BACKENDS.DRIVE);
  if (doc?.onedriveFileId) backends.push(STORAGE_BACKENDS.ONEDRIVE);
  if (!backends.length) backends.push(STORAGE_BACKENDS.LOCAL);
  return backends;
}

export function documentHasStorageBackend(doc, backend) {
  return listDocumentStorageBackends(doc).includes(backend);
}

export function getActiveStorageBackend() {
  const mode = getResolvedStorageMode();
  if (mode === STORAGE_MODES.DRIVE) return STORAGE_BACKENDS.DRIVE;
  if (mode === STORAGE_MODES.MEGA) return STORAGE_BACKENDS.MEGA;
  if (mode === STORAGE_MODES.ONEDRIVE) return STORAGE_BACKENDS.ONEDRIVE;
  if (mode === STORAGE_MODES.GITHUB) return STORAGE_BACKENDS.GITHUB;
  return STORAGE_BACKENDS.LOCAL;
}

export function getStorageBackendLabel(backend) {
  if (backend === STORAGE_BACKENDS.DRIVE) return "Google Drive";
  if (backend === STORAGE_BACKENDS.MEGA) return "MEGA";
  if (backend === STORAGE_BACKENDS.ONEDRIVE) return "OneDrive";
  if (backend === STORAGE_BACKENDS.GITHUB) return "GitHub";
  return "محلي";
}

export function getStorageBackendIcon(backend) {
  if (backend === STORAGE_BACKENDS.DRIVE) return "☁️";
  if (backend === STORAGE_BACKENDS.MEGA) return "🟥";
  if (backend === STORAGE_BACKENDS.ONEDRIVE) return "🔷";
  if (backend === STORAGE_BACKENDS.GITHUB) return "🐙";
  return "💾";
}

export function getDocumentStoragePath(doc) {
  const category = doc.category || "عام";
  const filename = doc.filename || "مستند";
  const paths = [];

  if (doc?.fileData) {
    const repo = GITHUB_OWNER && GITHUB_REPO ? `${GITHUB_OWNER}/${GITHUB_REPO}` : "المستودع";
    paths.push(`${repo} / data / ${category} / ${filename}`);
  }
  if (doc?.megaFileId) {
    paths.push(`MEGA / مخزن الوثائق / ${category} / ${filename}`);
  }
  if (doc?.driveFileId) {
    paths.push(`مخزن الوثائق / ${category} / ${filename}`);
  }
  if (doc?.onedriveFileId) {
    paths.push(`OneDrive / مخزن الوثائق / ${category} / ${filename}`);
  }
  if (!paths.length) {
    return `محلي / ${category} / ${filename}`;
  }
  return paths.join(" · ");
}

export function documentMatchesActiveStorage(doc, { showAll = false } = {}) {
  if (showAll) return true;
  const backends = listDocumentStorageBackends(doc);
  if (backends.length > 1) return true;
  return backends[0] === getActiveStorageBackend();
}
