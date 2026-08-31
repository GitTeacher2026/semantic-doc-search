import { ADMIN_EMAIL, ONEDRIVE_CLIENT_ID, SITE_URL } from "./config.js";

const TOKEN_KEY = "docshelf_onedrive_token";
const TOKEN_EXPIRY_KEY = "docshelf_onedrive_expiry";
const MSAL_URL = "https://esm.sh/@azure/msal-browser@3.28.0";

const SCOPES = ["Files.ReadWrite", "User.Read", "offline_access"];

let msalInstance = null;
let loginPromise = null;

export function getOneDriveClientId() {
  return String(ONEDRIVE_CLIENT_ID || "").trim();
}

export function isOneDriveConfigured() {
  return getOneDriveClientId().length >= 8;
}

function getRedirectUri() {
  const configured = String(SITE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}`;
}

export function getStoredAccessToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  if (!token || Date.now() >= expiry - 60_000) return null;
  return token;
}

export function isOneDriveConnected() {
  return Boolean(getStoredAccessToken());
}

export function clearOneDriveSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  loginPromise = null;
}

function storeAccessToken(token, expiresInSeconds = 3600) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
}

async function verifyOneDriveAccount(accessToken) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("تعذّر التحقق من حساب Microsoft.");
  const profile = await res.json();
  const email = String(profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (email !== ADMIN_EMAIL.toLowerCase()) {
    clearOneDriveSession();
    throw new Error(`يجب تسجيل الدخول بحساب ${ADMIN_EMAIL} للوصول إلى OneDrive.`);
  }
  return profile;
}

async function getMsalInstance() {
  if (!isOneDriveConfigured()) {
    throw new Error(
      "OneDrive غير مضبوط. أضف ONEDRIVE_CLIENT_ID في GitHub Secrets ثم أعد نشر الموقع."
    );
  }
  if (!msalInstance) {
    const { PublicClientApplication } = await import(MSAL_URL);
    msalInstance = new PublicClientApplication({
      auth: {
        clientId: getOneDriveClientId(),
        authority: "https://login.microsoftonline.com/common",
        redirectUri: getRedirectUri(),
      },
      cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
      },
    });
    await msalInstance.initialize();
  }
  return msalInstance;
}

export async function loginToOneDrive() {
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const msal = await getMsalInstance();
    const result = await msal.loginPopup({
      scopes: SCOPES,
      loginHint: ADMIN_EMAIL,
      prompt: "select_account",
    });
    const token = result.accessToken;
    if (!token) {
      throw new Error("تعذّر الحصول على رمز OneDrive.");
    }
    storeAccessToken(token, result.expiresOn ? Math.floor((result.expiresOn.getTime() - Date.now()) / 1000) : 3600);
    const profile = await verifyOneDriveAccount(token);
    return { token, profile };
  })();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

export async function getOneDriveAccessToken({ interactive = false } = {}) {
  const existing = getStoredAccessToken();
  if (existing) {
    try {
      await verifyOneDriveAccount(existing);
      return existing;
    } catch {
      clearOneDriveSession();
    }
  }

  if (!interactive) return null;

  const { token } = await loginToOneDrive();
  return token;
}

export async function ensureOneDriveAccess({ interactive = false } = {}) {
  const token = await getOneDriveAccessToken({ interactive });
  if (!token) {
    throw new Error("يلزم تسجيل الدخول إلى OneDrive أولاً.");
  }
  return token;
}

export function logoutOneDrive() {
  clearOneDriveSession();
  msalInstance?.clearCache?.();
}
