import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  USERS_PATH,
} from "./config.js";

const DEFAULT_ADMIN = {
  id: "admin-default",
  username: "admin",
  firstName: "مدير",
  lastName: "النظام",
  email: "amanyak267@gmail.com",
  passwordHash: "EA7ALRaIWq3P05mCoRiRlsInyKr4JxTah7diD610IVo=",
  role: "admin",
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${USERS_PATH}`;
}

function isConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && USERS_PATH);
}

function authHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
  };
}

function decodeContent(content) {
  const normalized = String(content || "").replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function normalizeUsersDb(data) {
  const next = data && typeof data === "object" ? data : {};
  return {
    users: Array.isArray(next.users) ? next.users : [],
    pending: Array.isArray(next.pending) ? next.pending : [],
  };
}

export async function loadUsersDb() {
  if (!isConfigured()) {
    return normalizeUsersDb({ users: [DEFAULT_ADMIN], pending: [] });
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
  });

  if (res.status === 404) {
    const initial = normalizeUsersDb({ users: [DEFAULT_ADMIN], pending: [] });
    await saveUsersDb(initial, null);
    return initial;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `تعذّر تحميل حسابات المستخدمين (${res.status})`);
  }

  const payload = await res.json();
  return normalizeUsersDb(JSON.parse(decodeContent(payload.content)));
}

let usersSha = null;

export async function saveUsersDb(db, sha = usersSha) {
  const payload = normalizeUsersDb(db);
  if (!isConfigured()) {
    localStorage.setItem("docshelf_users_local", JSON.stringify(payload));
    return;
  }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const body = {
    message: "Update user accounts",
    content,
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiUrl(), {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `تعذّر حفظ حسابات المستخدمين (${res.status})`);
  }

  const result = await res.json();
  usersSha = result.content.sha;
}

export async function refreshUsersSha() {
  if (!isConfigured()) return;
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
  });
  if (res.ok) {
    const payload = await res.json();
    usersSha = payload.sha;
  }
}

export async function loadUsersDbWithSha() {
  if (!isConfigured()) {
    const local = localStorage.getItem("docshelf_users_local");
    return {
      db: normalizeUsersDb(local ? JSON.parse(local) : { users: [DEFAULT_ADMIN], pending: [] }),
      sha: null,
    };
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
  });

  if (res.status === 404) {
    const initial = normalizeUsersDb({ users: [DEFAULT_ADMIN], pending: [] });
    await saveUsersDb(initial, null);
    return { db: initial, sha: usersSha };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `تعذّر تحميل حسابات المستخدمين (${res.status})`);
  }

  const payload = await res.json();
  usersSha = payload.sha;
  return {
    db: normalizeUsersDb(JSON.parse(decodeContent(payload.content))),
    sha: usersSha,
  };
}
