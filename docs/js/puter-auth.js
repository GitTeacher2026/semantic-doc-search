import { PUTER_AUTH_TOKEN } from "./config.js";

const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";
const EMAIL_KEY = "docshelf_puter_email";
const TOKEN_KEY = "docshelf_puter_token";

let puterPromise = null;

function formatPuterAuthError(error) {
  const code = error?.error || error?.code || "";
  if (code === "popup_blocked") {
    return "حظر المتصفح نافذة تسجيل Puter. اسمح بالنوافذ المنبثقة أو استخدم رمز API.";
  }
  if (code === "auth_window_closed" || code === "auth_canceled") {
    return "أُلغي تسجيل الدخول إلى Puter.";
  }
  return error?.message || error?.msg || "تعذّر تسجيل الدخول إلى Puter.";
}

function isLikelyApiToken(value) {
  const token = String(value || "").trim();
  return token.length >= 24 && !/\s/.test(token);
}

export function getConfiguredPuterToken() {
  return String(PUTER_AUTH_TOKEN || "").trim();
}

export function isPuterPreconfigured() {
  return Boolean(getConfiguredPuterToken());
}

export function getPuterEmail() {
  return sessionStorage.getItem(EMAIL_KEY) || "";
}

export function getStoredPuterToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function getActivePuterToken() {
  return getStoredPuterToken() || getConfiguredPuterToken();
}

export function isPuterConnected() {
  if (isPuterPreconfigured()) return true;
  if (globalThis.puter?.authToken) return true;
  if (getStoredPuterToken()) return true;
  try {
    return Boolean(globalThis.puter?.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

export async function getPuterUserLabel() {
  try {
    const puter = await loadPuter();
    if (!puter.authToken && !puter.auth?.isSignedIn?.()) {
      return isPuterPreconfigured() ? "Puter AI" : getPuterEmail();
    }
    const user = await puter.auth.getUser();
    return user?.username || user?.email || getPuterEmail() || "Puter";
  } catch {
    if (isPuterPreconfigured()) return "Puter AI";
    return getPuterEmail() || "Puter";
  }
}

export async function loadPuter() {
  if (!puterPromise) {
    puterPromise = new Promise((resolve, reject) => {
      if (globalThis.puter) {
        resolve(globalThis.puter);
        return;
      }
      const existing = document.querySelector('script[src*="js.puter.com"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(globalThis.puter), { once: true });
        existing.addEventListener("error", () => reject(new Error("تعذّر تحميل Puter.js.")), {
          once: true,
        });
        return;
      }
      const script = document.createElement("script");
      script.src = PUTER_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve(globalThis.puter);
      script.onerror = () => reject(new Error("تعذّر تحميل Puter.js."));
      document.head.appendChild(script);
    });
  }

  const puter = await puterPromise;
  if (!puter) {
    throw new Error("Puter.js غير متاح في هذا المتصفح.");
  }

  const token = getActivePuterToken();
  if (token && !puter.authToken) {
    puter.setAuthToken(token);
  }

  return puter;
}

async function verifyPuterSession(puter) {
  if (!puter.authToken && !puter.auth?.isSignedIn?.()) {
    throw new Error("لم يكتمل تسجيل الدخول إلى Puter.");
  }
  try {
    await puter.auth.getUser();
  } catch {
    if (!puter.authToken) {
      throw new Error("لم يكتمل تسجيل الدخول إلى Puter.");
    }
    // JWT/API tokens may not return a user profile but still work for AI calls.
  }
}

async function applyToken(puter, token, { persist = false } = {}) {
  const secret = String(token || "").trim();
  if (!secret) return false;

  puter.setAuthToken(secret);
  try {
    await verifyPuterSession(puter);
    if (persist) {
      sessionStorage.setItem(TOKEN_KEY, secret);
    }
    return true;
  } catch (error) {
    puter.setAuthToken("");
    if (persist) {
      sessionStorage.removeItem(TOKEN_KEY);
    }
    throw error;
  }
}

export async function loginToPuter({ email = "", password = "" } = {}) {
  const puter = await loadPuter();
  const normalizedEmail = String(email || "").trim();
  const secret = String(password || "").trim();

  if (normalizedEmail) {
    sessionStorage.setItem(EMAIL_KEY, normalizedEmail);
  }

  if (secret && isLikelyApiToken(secret)) {
    try {
      await applyToken(puter, secret, { persist: true });
      return puter;
    } catch {
      throw new Error("رمز Puter API غير صالح. أنشئ رمزاً من puter.com/dashboard.");
    }
  }

  if (secret) {
    throw new Error(
      "لا يمكن استخدام كلمة مرور Puter مباشرة هنا. الصق رمز API من لوحة Puter، أو اترك كلمة المرور فارغة واضغط «الاتصال» لفتح نافذة تسجيل Puter."
    );
  }

  try {
    if (puter.ui?.authenticateWithPuter) {
      await puter.ui.authenticateWithPuter();
    } else {
      await puter.auth.signIn({ request_auth: true });
    }
    sessionStorage.removeItem(TOKEN_KEY);
    await verifyPuterSession(puter);
    return puter;
  } catch (error) {
    throw new Error(formatPuterAuthError(error));
  }
}

export async function ensurePuterConnected() {
  const puter = await loadPuter();

  if (puter.authToken || puter.auth?.isSignedIn?.()) {
    try {
      await verifyPuterSession(puter);
      return puter;
    } catch {
      puter.setAuthToken("");
    }
  }

  const savedToken = getStoredPuterToken();
  if (savedToken) {
    try {
      await applyToken(puter, savedToken);
      return puter;
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
      puter.setAuthToken("");
    }
  }

  const configToken = getConfiguredPuterToken();
  if (configToken) {
    await applyToken(puter, configToken);
    return puter;
  }

  throw new Error("يلزم تسجيل الدخول إلى Puter AI أولاً — أدخل رمز API أو اتصل بحساب Puter.");
}

export function logoutPuter() {
  try {
    globalThis.puter?.setAuthToken?.("");
    globalThis.puter?.auth?.signOut?.();
  } catch {
    /* ignore */
  }
  sessionStorage.removeItem(TOKEN_KEY);

  const configToken = getConfiguredPuterToken();
  if (configToken && globalThis.puter) {
    globalThis.puter.setAuthToken(configToken);
  }

  puterPromise = null;
}
