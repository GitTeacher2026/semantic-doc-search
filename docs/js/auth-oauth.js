import {
  GITHUB_OAUTH_CLIENT_ID,
  GOOGLE_CLIENT_ID,
  ONEDRIVE_CLIENT_ID,
  SITE_URL,
} from "./config.js";

const MSAL_URL = "https://esm.sh/@azure/msal-browser@3.28.0";

function getRedirectUri() {
  const configured = String(SITE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}`;
}

function normalizeProfile({ provider, subject, email, firstName, lastName, username }) {
  return {
    provider,
    subject: String(subject || ""),
    email: String(email || "").trim().toLowerCase(),
    firstName: String(firstName || "").trim() || "عضو",
    lastName: String(lastName || "").trim() || "جديد",
    username: String(username || "").trim().toLowerCase(),
  };
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

export function isGoogleAuthConfigured() {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(String(GOOGLE_CLIENT_ID || "").trim());
}

export function isMicrosoftAuthConfigured() {
  return String(ONEDRIVE_CLIENT_ID || "").trim().length >= 8;
}

export function isGitHubAuthConfigured() {
  return String(GITHUB_OAUTH_CLIENT_ID || "").trim().length >= 8;
}

export function getAvailableAuthProviders() {
  const providers = [];
  if (isGoogleAuthConfigured()) providers.push("google");
  if (isMicrosoftAuthConfigured()) providers.push("microsoft");
  if (isGitHubAuthConfigured()) providers.push("github");
  return providers;
}

export async function loginWithGoogle() {
  if (!isGoogleAuthConfigured()) {
    throw new Error("تسجيل الدخول عبر Google غير مفعّل. أضف GOOGLE_CLIENT_ID في إعدادات النشر.");
  }

  await loadGoogleScript();
  const clientId = String(GOOGLE_CLIENT_ID).trim();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: async (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error || "تعذّر تسجيل الدخول عبر Google."));
          return;
        }
        try {
          const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${response.access_token}` },
          });
          if (!res.ok) throw new Error("تعذّر قراءة ملف Google.");
          const profile = await res.json();
          resolve(
            normalizeProfile({
              provider: "google",
              subject: profile.sub,
              email: profile.email,
              firstName: profile.given_name,
              lastName: profile.family_name,
              username: String(profile.email || "").split("@")[0],
            })
          );
        } catch (error) {
          reject(error);
        }
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

let msalInstance = null;

async function getMsalInstance() {
  if (!isMicrosoftAuthConfigured()) {
    throw new Error("تسجيل الدخول عبر Microsoft غير مفعّل. أضف ONEDRIVE_CLIENT_ID في إعدادات النشر.");
  }
  if (!msalInstance) {
    const { PublicClientApplication } = await import(MSAL_URL);
    msalInstance = new PublicClientApplication({
      auth: {
        clientId: String(ONEDRIVE_CLIENT_ID).trim(),
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

export async function loginWithMicrosoft() {
  const msal = await getMsalInstance();
  const result = await msal.loginPopup({
    scopes: ["openid", "profile", "User.Read", "email"],
    prompt: "select_account",
  });

  const token = result.accessToken;
  if (!token) throw new Error("تعذّر الحصول على رمز Microsoft.");

  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("تعذّر قراءة ملف Microsoft.");
  const profile = await res.json();
  const email = String(profile.mail || profile.userPrincipalName || "").toLowerCase();

  return normalizeProfile({
    provider: "microsoft",
    subject: profile.id,
    email,
    firstName: profile.givenName,
    lastName: profile.surname,
    username: email.split("@")[0],
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollGitHubDeviceToken(clientId, deviceCode, intervalSeconds) {
  const waitMs = Math.max(5, intervalSeconds || 5) * 1000;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(waitMs);
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (payload.access_token) return payload.access_token;
    if (payload.error === "authorization_pending") continue;
    if (payload.error === "slow_down") {
      await sleep(5000);
      continue;
    }
    throw new Error(payload.error_description || payload.error || "تعذّر تسجيل الدخول عبر GitHub.");
  }
  throw new Error("انتهت مهلة تسجيل الدخول عبر GitHub. حاول مرة أخرى.");
}

export async function loginWithGitHub({ onDeviceAuth } = {}) {
  const clientId = String(GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (!isGitHubAuthConfigured()) {
    throw new Error("تسجيل الدخول عبر GitHub غير مفعّل. أضف GITHUB_OAUTH_CLIENT_ID في إعدادات النشر.");
  }

  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "read:user user:email",
    }),
  });

  const codePayload = await codeRes.json().catch(() => ({}));
  if (!codeRes.ok || !codePayload.device_code) {
    throw new Error(codePayload.error_description || codePayload.error || "تعذّر بدء تسجيل الدخول عبر GitHub.");
  }

  onDeviceAuth?.({
    verificationUri: codePayload.verification_uri,
    userCode: codePayload.user_code,
  });

  const accessToken = await pollGitHubDeviceToken(
    clientId,
    codePayload.device_code,
    codePayload.interval
  );

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userRes.ok) throw new Error("تعذّر قراءة ملف GitHub.");
  const user = await userRes.json();

  let email = String(user.email || "").toLowerCase();
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = emails.find((item) => item.primary && item.verified);
      const verified = emails.find((item) => item.verified);
      email = String((primary || verified || emails[0])?.email || "").toLowerCase();
    }
  }

  const nameParts = String(user.name || "").trim().split(/\s+/);
  return normalizeProfile({
    provider: "github",
    subject: String(user.id),
    email,
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(" ") || user.login,
    username: user.login,
  });
}

export async function loginWithProvider(provider, options = {}) {
  if (provider === "google") return loginWithGoogle();
  if (provider === "microsoft") return loginWithMicrosoft();
  if (provider === "github") return loginWithGitHub(options);
  throw new Error("مزوّد تسجيل دخول غير معروف.");
}
