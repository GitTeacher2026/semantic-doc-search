import { isDriveConfigured } from "./drive-auth.js";
import { isGitHubStorageConfigured } from "./github-storage.js";

const STORAGE_MODE_KEY = "docshelf_storage_mode";

export const STORAGE_MODES = {
  DRIVE: "drive",
  GITHUB: "github",
};

export function isDriveModeAvailable() {
  return isDriveConfigured();
}

export function isGitHubModeAvailable() {
  return isGitHubStorageConfigured();
}

export function hasStorageChoice() {
  return isDriveModeAvailable() && isGitHubModeAvailable();
}

export function getDefaultStorageMode() {
  if (isGitHubModeAvailable()) return STORAGE_MODES.GITHUB;
  if (isDriveModeAvailable()) return STORAGE_MODES.DRIVE;
  return STORAGE_MODES.GITHUB;
}

export function getStorageMode() {
  const saved = localStorage.getItem(STORAGE_MODE_KEY);
  if (saved === STORAGE_MODES.DRIVE || saved === STORAGE_MODES.GITHUB) {
    return saved;
  }
  return getDefaultStorageMode();
}

export function getResolvedStorageMode() {
  const preferred = getStorageMode();
  if (preferred === STORAGE_MODES.DRIVE && isDriveModeAvailable()) {
    return STORAGE_MODES.DRIVE;
  }
  if (preferred === STORAGE_MODES.GITHUB && isGitHubModeAvailable()) {
    return STORAGE_MODES.GITHUB;
  }
  return getDefaultStorageMode();
}

export function setStorageMode(mode) {
  if (mode !== STORAGE_MODES.DRIVE && mode !== STORAGE_MODES.GITHUB) return;
  localStorage.setItem(STORAGE_MODE_KEY, mode);
}

export function getStorageModeLabel(mode = getResolvedStorageMode()) {
  return mode === STORAGE_MODES.DRIVE ? "Google Drive" : "GitHub";
}
