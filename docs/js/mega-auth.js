import { MEGA_EMAIL, MEGA_PASSWORD } from "./config.js";

const MEGA_MODULE_URL = "https://esm.sh/megajs@1.3.5/dist/main.browser-es.mjs";
const SESSION_EMAIL_KEY = "docshelf_mega_email";
const SESSION_PASSWORD_KEY = "docshelf_mega_password";

let megaStorage = null;
let megaEmail = null;
let loginPromise = null;
let lastAuthError = null;
let authNeedsRecovery = false;

export function hasMegaSessionCredentials() {
  return Boolean(
    String(sessionStorage.getItem(SESSION_EMAIL_KEY) || "").trim() &&
      String(sessionStorage.getItem(SESSION_PASSWORD_KEY) || "")
  );
}

export function getMegaSessionCredentials() {
  return {
    email: String(sessionStorage.getItem(SESSION_EMAIL_KEY) || "").trim(),
    password: String(sessionStorage.getItem(SESSION_PASSWORD_KEY) || ""),
  };
}

export function setMegaSessionCredentials(email, password) {
  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("أدخل بريد MEGA وكلمة المرور.");
  }
  sessionStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
  sessionStorage.setItem(SESSION_PASSWORD_KEY, normalizedPassword);
}

export function clearMegaSessionCredentials() {
  sessionStorage.removeItem(SESSION_EMAIL_KEY);
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
}

function resolveMegaCredentials() {
  const session = getMegaSessionCredentials();
  if (session.email && session.password) return session;
  return {
    email: String(MEGA_EMAIL || "").trim(),
    password: String(MEGA_PASSWORD || ""),
  };
}

export function isMegaConfigured() {
  const creds = resolveMegaCredentials();
  return Boolean(creds.email && creds.password);
}

export function isMegaConnected() {
  return Boolean(megaStorage);
}

export function getMegaEmail() {
  return megaEmail || resolveMegaCredentials().email;
}

export function getLastMegaAuthError() {
  return lastAuthError;
}

export function needsMegaAuthRecovery() {
  if (authNeedsRecovery) return true;
  return !isMegaConnected() && isMegaConfigured();
}

export function markMegaAuthFailed(message) {
  lastAuthError = message || "تعذّر الاتصال بـ MEGA.";
  authNeedsRecovery = true;
}

export function clearMegaAuthFailed() {
  lastAuthError = null;
  authNeedsRecovery = false;
}

export function getMegaStorage() {
  if (!megaStorage) {
    throw new Error("يلزم تسجيل الدخول إلى MEGA أولاً.");
  }
  return megaStorage;
}

export function logoutMega({ clearSession = false } = {}) {
  try {
    megaStorage?.close?.();
  } catch {
    /* ignore */
  }
  megaStorage = null;
  megaEmail = null;
  loginPromise = null;
  if (clearSession) {
    clearMegaSessionCredentials();
  }
}

export async function loginToMega(email, password, { persistSession = false } = {}) {
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
    if (persistSession) {
      setMegaSessionCredentials(normalizedEmail, normalizedPassword);
    }
    clearMegaAuthFailed();
    return storage;
  })();

  try {
    return await loginPromise;
  } catch (error) {
    markMegaAuthFailed(error.message || "تعذّر تسجيل الدخول إلى MEGA.");
    throw error;
  } finally {
    loginPromise = null;
  }
}

export async function ensureMegaAutoLogin() {
  if (isMegaConnected()) return megaStorage;

  const creds = resolveMegaCredentials();
  if (!creds.email || !creds.password) return null;

  try {
    const shouldPersist = hasMegaSessionCredentials();
    return await loginToMega(creds.email, creds.password, { persistSession: shouldPersist });
  } catch (error) {
    markMegaAuthFailed(error.message);
    throw error;
  }
}
