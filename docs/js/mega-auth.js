import { MEGA_EMAIL, MEGA_PASSWORD } from "./config.js";

const MEGA_MODULE_URL = "https://esm.sh/megajs@1.3.5/dist/main.browser-es.mjs";

let megaStorage = null;
let megaEmail = null;
let loginPromise = null;

export function isMegaConfigured() {
  return Boolean(String(MEGA_EMAIL || "").trim() && String(MEGA_PASSWORD || "").trim());
}

export function isMegaConnected() {
  return Boolean(megaStorage);
}

export function getMegaEmail() {
  return megaEmail || String(MEGA_EMAIL || "").trim();
}

export function getMegaStorage() {
  if (!megaStorage) {
    throw new Error("يلزم تسجيل الدخول إلى MEGA أولاً.");
  }
  return megaStorage;
}

export function logoutMega() {
  try {
    megaStorage?.close?.();
  } catch {
    /* ignore */
  }
  megaStorage = null;
  megaEmail = null;
  loginPromise = null;
}

export async function loginToMega(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("بيانات اعتماد MEGA غير متوفرة.");
  }

  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    logoutMega();
    const { Storage } = await import(MEGA_MODULE_URL);
    const storage = new Storage({
      email: normalizedEmail,
      password: normalizedPassword,
    });
    await storage.ready;
    megaStorage = storage;
    megaEmail = normalizedEmail;
    return storage;
  })();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

export async function ensureMegaAutoLogin() {
  if (isMegaConnected()) return megaStorage;
  if (!isMegaConfigured()) return null;
  return loginToMega(MEGA_EMAIL, MEGA_PASSWORD);
}
