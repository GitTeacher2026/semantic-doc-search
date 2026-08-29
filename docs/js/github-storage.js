import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  STORE_PATH,
} from "./config.js";

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${STORE_PATH}`;
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

export async function fetchEncryptedStore() {
  if (!isGitHubStorageConfigured()) {
    return { envelope: null, sha: null };
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
  });

  if (res.status === 404) {
    return { envelope: null, sha: null };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `تعذّر قراءة التخزين السحابي (${res.status})`);
  }

  const payload = await res.json();
  const text = decodeContent(payload.content);
  return { envelope: JSON.parse(text), sha: payload.sha };
}

export async function uploadEncryptedStore(envelope, sha) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
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
    throw new Error(err.message || `تعذّر حفظ التخزين السحابي (${res.status})`);
  }

  const result = await res.json();
  return result.content.sha;
}
