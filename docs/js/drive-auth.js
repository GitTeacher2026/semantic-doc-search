import { ADMIN_EMAIL, GOOGLE_CLIENT_ID } from "./config.js";

const TOKEN_KEY = "docshelf_drive_token";
const TOKEN_EXPIRY_KEY = "docshelf_drive_expiry";
const CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/;

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

let tokenClient = null;

export function getGoogleClientId() {
  return String(GOOGLE_CLIENT_ID || "").trim();
}

export function isDriveConfigured() {
  return CLIENT_ID_PATTERN.test(getGoogleClientId());
}

export function getStoredAccessToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || 0);
  if (!token || Date.now() >= expiry - 60_000) return null;
  return token;
}

export function clearDriveSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("تعذّر تحميل Google Sign-In.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("تعذّر تحميل Google Sign-In."));
    document.head.appendChild(script);
  });
}

async function verifyDriveAccount(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("تعذّر التحقق من حساب Google.");
  const profile = await res.json();
  const email = String(profile.email || "").toLowerCase();
  if (email !== ADMIN_EMAIL.toLowerCase()) {
    clearDriveSession();
    throw new Error(`يجب تسجيل الدخول بحساب ${ADMIN_EMAIL} للوصول إلى Google Drive.`);
  }
  return profile;
}

function storeAccessToken(response) {
  sessionStorage.setItem(TOKEN_KEY, response.access_token);
  sessionStorage.setItem(
    TOKEN_EXPIRY_KEY,
    String(Date.now() + Number(response.expires_in || 3600) * 1000)
  );
}

export async function ensureDriveAccess({ interactive = true } = {}) {
  const existing = getStoredAccessToken();
  if (existing) {
    try {
      await verifyDriveAccount(existing);
      return existing;
    } catch {
      clearDriveSession();
    }
  }

  if (!interactive) {
    throw new Error("يلزم ربط Google Drive أولاً.");
  }

  if (!isDriveConfigured()) {
    throw new Error(
      "Google Drive غير مضبوط. أضف GOOGLE_CLIENT_ID الصحيح في GitHub Secrets ثم أعد نشر الموقع."
    );
  }

  await loadGoogleScript();
  const clientId = getGoogleClientId();

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPES,
      hint: ADMIN_EMAIL,
      callback: async (response) => {
        if (response.error) {
          const message =
            response.error === "invalid_client"
              ? "معرّف Google OAuth غير صالح. أنشئ OAuth Client ID من نوع Web application في Google Cloud، ثم ضعه في GitHub Secret باسم GOOGLE_CLIENT_ID."
              : response.error_description || response.error;
          reject(new Error(message));
          return;
        }
        try {
          storeAccessToken(response);
          await verifyDriveAccount(response.access_token);
          resolve(response.access_token);
        } catch (error) {
          reject(error);
        }
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}
