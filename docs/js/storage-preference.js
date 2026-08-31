import { isGitHubStorageConfigured } from "./github-storage.js";

export const STORAGE_MODES = {
  GITHUB: "github",
};

export function isDriveModeAvailable() {
  return false;
}

export function isGitHubModeAvailable() {
  return isGitHubStorageConfigured();
}

export function hasStorageChoice() {
  return false;
}

export function getDefaultStorageMode() {
  return STORAGE_MODES.GITHUB;
}

export function getStorageMode() {
  return STORAGE_MODES.GITHUB;
}

export function getResolvedStorageMode() {
  return STORAGE_MODES.GITHUB;
}

export function setStorageMode() {
  // GitHub-only storage.
}

export function getStorageModeLabel(mode = getResolvedStorageMode()) {
  return mode === STORAGE_MODES.GITHUB ? "GitHub" : "GitHub";
}
