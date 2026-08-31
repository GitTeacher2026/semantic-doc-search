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
  email: "reagon.gm@pm.me",
  passwordHash: "TX7vVAE6FDguGaKHcyFpvneq9wwAT5LK5tFbehdA2nM=",
  role: "admin",
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${USERS_PATH}`;
}

function rawUrl() {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${USERS_PATH}`;
}

function isConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && USERS_PATH);
}

function canReadRemote() {
  return Boolean(GITHUB_OWNER && GITHUB_REPO && USERS_PATH);
}

async function fetchUsersFromRaw() {
  const res = await fetch(rawUrl(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`تعذّر تحميل حسابات المستخدمين (${res.status})`);
  }
  return normalizeUsersDb(await res.json());
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
  if (!canReadRemote()) {
    return normalizeUsersDb({ users: [DEFAULT_ADMIN], pending: [] });
  }

  if (!isConfigured()) {
    return fetchUsersFromRaw();
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
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

  if (!sha) {
    await refreshUsersSha();
    sha = usersSha;
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
    const message = String(err.message || "");
    if (/not accessible by personal access token/i.test(message)) {
      throw new Error(
        "مفتاح GitHub لا يملك صلاحية الكتابة على المستودع. حدّث DOCSHELF_GITHUB_TOKEN بصلاحية Contents: Read and write ثم أعد النشر."
      );
    }
    throw new Error(message || `تعذّر حفظ حسابات المستخدمين (${res.status})`);
  }

  const result = await res.json();
  usersSha = result.content.sha;
}

export async function refreshUsersSha() {
  if (!isConfigured()) return;
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.ok) {
    const payload = await res.json();
    usersSha = payload.sha;
  }
}

export async function loadUsersDbWithSha() {
  if (!canReadRemote()) {
    const local = localStorage.getItem("docshelf_users_local");
    return {
      db: normalizeUsersDb(local ? JSON.parse(local) : { users: [DEFAULT_ADMIN], pending: [] }),
      sha: null,
    };
  }

  if (!isConfigured()) {
    return { db: await fetchUsersFromRaw(), sha: null };
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 404) {
    const initial = normalizeUsersDb({ users: [DEFAULT_ADMIN], pending: [] });
    await saveUsersDb(initial, null);
    return { db: initial, sha: usersSha };
  }

  if (!res.ok) {
    return { db: await fetchUsersFromRaw(), sha: usersSha };
  }

  const payload = await res.json();
  usersSha = payload.sha;
  return {
    db: normalizeUsersDb(JSON.parse(decodeContent(payload.content))),
    sha: usersSha,
  };
}
