import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  STORE_PATH,
} from "./config.js";
import { bytesToBase64 } from "./crypto.js";
import { formatGitHubApiError, isGitHubShaConflict } from "./github-errors.js";

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${STORE_PATH}`;
}

function rawStoreUrl() {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${STORE_PATH}`;
}

export function isGitHubStorageConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && STORE_PATH);
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

async function fetchEnvelopeText(payload) {
  if (payload?.encoding === "base64" && payload.content) {
    return decodeContent(payload.content);
  }

  const downloadUrl = payload?.download_url;
  if (downloadUrl) {
    const res = await fetch(downloadUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`تعذّر تحميل مخزن المستندات (${res.status})`);
    }
    return res.text();
  }

  const res = await fetch(rawStoreUrl(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`تعذّر تحميل مخزن المستندات (${res.status})`);
  }
  return res.text();
}

export async function fetchEncryptedStore() {
  if (!isGitHubStorageConfigured()) {
    return { envelope: null, sha: null };
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 404) {
    return { envelope: null, sha: null };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatGitHubApiError(err.message, res.status));
  }

  const payload = await res.json();
  const text = await fetchEnvelopeText(payload);
  if (!String(text || "").trim()) {
    throw new Error("ملف مخزن المستندات فارغ على GitHub.");
  }

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("تعذّر قراءة مخزن المستندات من GitHub — الملف تالف أو غير مكتمل.");
  }

  return { envelope, sha: payload.sha };
}

async function putEncryptedStore(envelope, sha) {
  const content = bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
  const body = {
    message: "Update encrypted document store",
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
    const error = new Error(formatGitHubApiError(err.message, res.status));
    error.status = res.status;
    throw error;
  }

  const result = await res.json();
  return result.content.sha;
}

export async function uploadEncryptedStore(envelope, sha) {
  let currentSha = sha;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await putEncryptedStore(envelope, currentSha);
    } catch (error) {
      lastError = error;
      if (!isGitHubShaConflict(error) || attempt >= 2) {
        throw error;
      }
      const latest = await fetchEncryptedStore();
      currentSha = latest.sha;
    }
  }

  throw lastError || new Error("تعذّر حفظ المستندات على GitHub.");
}
