import { base64ToBytes, bytesToBase64, decryptJson, deriveKey, encryptJson } from "./crypto.js";
import {
  fetchEncryptedStore as fetchDriveStore,
  uploadEncryptedStore as uploadDriveStore,
} from "./drive-storage.js";
import {
  fetchEncryptedStore as fetchGitHubStore,
  isGitHubStorageConfigured,
  uploadEncryptedStore as uploadGitHubStore,
} from "./github-storage.js";
import {
  fetchEncryptedStore as fetchMegaStore,
  uploadEncryptedStore as uploadMegaStore,
} from "./mega-storage.js";
import {
  fetchEncryptedStore as fetchOneDriveStore,
  uploadEncryptedStore as uploadOneDriveStore,
} from "./onedrive-storage.js";
import { isDriveConnected } from "./drive-auth.js";
import { isMegaConnected } from "./mega-auth.js";
import { isOneDriveConnected } from "./onedrive-auth.js";
import { normalizeState, purgeExpiredTrash } from "./trash.js";
import { getResolvedStorageMode, STORAGE_MODES } from "./storage-preference.js";

const LOCAL_CACHE_KEY = "docshelf_store_v5";

let sessionKey = null;
let currentSalt = null;
let remoteHandle = null;

function loadLocalDocuments() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || "{}"));
  } catch {
    return normalizeState({});
  }
}

function saveLocalDocuments(state) {
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(normalizeState(state)));
}

function finalizeState(state) {
  return purgeExpiredTrash(normalizeState(state));
}

function isModeReady(mode) {
  if (mode === STORAGE_MODES.GITHUB) return isGitHubStorageConfigured();
  if (mode === STORAGE_MODES.DRIVE) return isDriveConnected();
  if (mode === STORAGE_MODES.MEGA) return isMegaConnected();
  if (mode === STORAGE_MODES.ONEDRIVE) return isOneDriveConnected();
  return true;
}

export function isCloudSyncEnabled() {
  const mode = getResolvedStorageMode();
  if (mode === STORAGE_MODES.LOCAL) return false;
  return isModeReady(mode);
}

export function isUsingDriveStorage() {
  return getResolvedStorageMode() === STORAGE_MODES.DRIVE && isDriveConnected();
}

export function isUsingGitHubStorage() {
  return getResolvedStorageMode() === STORAGE_MODES.GITHUB && isGitHubStorageConfigured();
}

export function isUsingMegaStorage() {
  return getResolvedStorageMode() === STORAGE_MODES.MEGA && isMegaConnected();
}

export function isUsingOneDriveStorage() {
  return getResolvedStorageMode() === STORAGE_MODES.ONEDRIVE && isOneDriveConnected();
}

export function isUsingRemoteFileStorage() {
  return isUsingDriveStorage() || isUsingMegaStorage() || isUsingOneDriveStorage();
}

async function fetchRemoteStore() {
  const mode = getResolvedStorageMode();
  if (mode === STORAGE_MODES.GITHUB && isGitHubStorageConfigured()) {
    const { envelope, sha } = await fetchGitHubStore();
    return { envelope, handle: { type: STORAGE_MODES.GITHUB, sha } };
  }
  if (mode === STORAGE_MODES.DRIVE && isDriveConnected()) {
    const { envelope, fileId } = await fetchDriveStore();
    return { envelope, handle: { type: STORAGE_MODES.DRIVE, fileId } };
  }
  if (mode === STORAGE_MODES.MEGA && isMegaConnected()) {
    const { envelope, fileId } = await fetchMegaStore();
    return { envelope, handle: { type: STORAGE_MODES.MEGA, fileId } };
  }
  if (mode === STORAGE_MODES.ONEDRIVE && isOneDriveConnected()) {
    const { envelope, fileId } = await fetchOneDriveStore();
    return { envelope, handle: { type: STORAGE_MODES.ONEDRIVE, fileId } };
  }
  return { envelope: null, handle: null };
}

async function uploadRemoteStore(envelope, handle) {
  const mode = handle?.type || getResolvedStorageMode();
  if (mode === STORAGE_MODES.GITHUB) {
    const sha = await uploadGitHubStore(envelope, handle?.sha ?? null);
    return { type: STORAGE_MODES.GITHUB, sha };
  }
  if (mode === STORAGE_MODES.DRIVE) {
    const fileId = await uploadDriveStore(envelope, handle?.fileId ?? null);
    return { type: STORAGE_MODES.DRIVE, fileId };
  }
  if (mode === STORAGE_MODES.MEGA) {
    const fileId = await uploadMegaStore(envelope, handle?.fileId ?? null);
    return { type: STORAGE_MODES.MEGA, fileId };
  }
  if (mode === STORAGE_MODES.ONEDRIVE) {
    const fileId = await uploadOneDriveStore(envelope, handle?.fileId ?? null);
    return { type: STORAGE_MODES.ONEDRIVE, fileId };
  }
  return handle;
}

export async function loadDocuments(password) {
  if (!isCloudSyncEnabled()) {
    return finalizeState(loadLocalDocuments());
  }

  const { envelope, handle } = await fetchRemoteStore();
  remoteHandle = handle;

  if (!envelope) {
    const local = finalizeState(loadLocalDocuments());
    currentSalt = crypto.getRandomValues(new Uint8Array(16));
    sessionKey = await deriveKey(password, currentSalt);
    if (local.documents.length || local.trash.length) {
      await saveDocuments(password, local);
      return local;
    }
    return normalizeState({});
  }

  currentSalt = base64ToBytes(envelope.salt);
  sessionKey = await deriveKey(password, currentSalt);

  try {
    const decrypted = await decryptJson(sessionKey, envelope.iv, envelope.ciphertext);
    return finalizeState(decrypted);
  } catch {
    throw new Error("كلمة المرور غير صحيحة أو بيانات التخزين تالفة.");
  }
}

export async function saveDocuments(password, state) {
  const payload = finalizeState(state);
  if (!isCloudSyncEnabled()) {
    saveLocalDocuments(payload);
    return;
  }

  if (!sessionKey || !currentSalt) {
    currentSalt = currentSalt || crypto.getRandomValues(new Uint8Array(16));
    sessionKey = await deriveKey(password, currentSalt);
  }

  const { iv, ciphertext } = await encryptJson(sessionKey, payload);
  const envelope = {
    version: 1,
    salt: bytesToBase64(currentSalt),
    iv,
    ciphertext,
  };

  try {
    remoteHandle = await uploadRemoteStore(envelope, remoteHandle);
    saveLocalDocuments(payload);
  } catch (error) {
    saveLocalDocuments(payload);
    throw error;
  }
}

export function clearStorageSession() {
  sessionKey = null;
  currentSalt = null;
  remoteHandle = null;
}
