import { base64ToBytes, bytesToBase64, decryptJson, deriveKey, encryptJson } from "./crypto.js";
import {
  fetchEncryptedStore,
  isGitHubStorageConfigured,
  uploadEncryptedStore,
} from "./github-storage.js";
import { normalizeState, purgeExpiredTrash } from "./trash.js";

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
  return isGitHubStorageConfigured();
}

export async function loadDocuments(password) {
  if (!isGitHubStorageConfigured()) {
    return finalizeState(loadLocalDocuments());
  }

  const { envelope, sha } = await fetchEncryptedStore();
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
  if (!isGitHubStorageConfigured()) {
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
    remoteSha = await uploadEncryptedStore(envelope, remoteSha);
  } catch (error) {
    if (String(error.message || "").includes("sha") || String(error.message || "").includes("409")) {
      const latest = await fetchEncryptedStore();
      remoteSha = await uploadEncryptedStore(envelope, latest.sha);
      return;
    }
    throw error;
  }
}

export function clearStorageSession() {
  sessionKey = null;
  currentSalt = null;
  remoteSha = null;
}
