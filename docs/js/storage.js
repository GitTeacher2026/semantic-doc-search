import { base64ToBytes, bytesToBase64, decryptJson, deriveKey, encryptJson } from "./crypto.js";
import {
  fetchEncryptedStore as fetchGitHubStore,
  isGitHubStorageConfigured,
  uploadEncryptedStore as uploadGitHubStore,
} from "./github-storage.js";
import { normalizeState, purgeExpiredTrash } from "./trash.js";
import { getResolvedStorageMode, STORAGE_MODES } from "./storage-preference.js";

const LOCAL_CACHE_KEY = "docshelf_store_v5";

let sessionKey = null;
let currentSalt = null;
let remoteSha = null;

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

export function isCloudSyncEnabled() {
  return getResolvedStorageMode() === STORAGE_MODES.GITHUB && isGitHubStorageConfigured();
}

export function isUsingDriveStorage() {
  return false;
}

export function isUsingGitHubStorage() {
  return getResolvedStorageMode() === STORAGE_MODES.GITHUB && isGitHubStorageConfigured();
}

async function fetchRemoteStore() {
  if (isGitHubStorageConfigured()) {
    const { envelope, sha } = await fetchGitHubStore();
    return { envelope, sha };
  }
  return { envelope: null, sha: null };
}

async function uploadRemoteStore(envelope) {
  if (isGitHubStorageConfigured()) {
    remoteSha = await uploadGitHubStore(envelope, remoteSha);
  }
}

export async function loadDocuments(password) {
  if (!isCloudSyncEnabled()) {
    return finalizeState(loadLocalDocuments());
  }

  const { envelope, sha } = await fetchRemoteStore();
  remoteSha = sha;

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
    await uploadRemoteStore(envelope);
    saveLocalDocuments(payload);
  } catch (error) {
    saveLocalDocuments(payload);
    throw error;
  }
}

export function clearStorageSession() {
  sessionKey = null;
  currentSalt = null;
  remoteSha = null;
}
