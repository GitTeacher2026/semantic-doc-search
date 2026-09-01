import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  STORE_PATH,
} from "./config.js";
import { bytesToBase64 } from "./crypto.js";
import { formatGitHubApiError, isGitHubShaConflict } from "./github-errors.js";

const CONTENTS_PUT_LIMIT_BYTES = 950_000;

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${STORE_PATH}`;
}

function rawStoreUrl() {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${STORE_PATH}`;
}

function gitApiUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`;
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

async function parseGitHubError(res) {
  const err = await res.json().catch(() => ({}));
  const error = new Error(formatGitHubApiError(err.message, res.status));
  error.status = res.status;
  return error;
}

async function getBranchHeadSha() {
  const res = await fetch(gitApiUrl(`/git/ref/heads/${GITHUB_BRANCH}`), {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
  const payload = await res.json();
  return payload.object.sha;
}

async function getCommitTreeSha(commitSha) {
  const res = await fetch(gitApiUrl(`/git/commits/${commitSha}`), {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
  const payload = await res.json();
  return payload.tree.sha;
}

async function createGitBlob(base64Content) {
  const res = await fetch(gitApiUrl("/git/blobs"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: base64Content,
      encoding: "base64",
    }),
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
  const payload = await res.json();
  return payload.sha;
}

async function createGitTree(baseTreeSha, blobSha) {
  const res = await fetch(gitApiUrl("/git/trees"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        {
          path: STORE_PATH,
          mode: "100644",
          type: "blob",
          sha: blobSha,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
  const payload = await res.json();
  return payload.sha;
}

async function createGitCommit(treeSha, parentSha) {
  const res = await fetch(gitApiUrl("/git/commits"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Update encrypted document store",
      tree: treeSha,
      parents: [parentSha],
    }),
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
  const payload = await res.json();
  return payload.sha;
}

async function updateBranchHead(commitSha) {
  const res = await fetch(gitApiUrl(`/git/refs/heads/${GITHUB_BRANCH}`), {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (!res.ok) {
    throw await parseGitHubError(res);
  }
}

async function putEncryptedStoreViaGit(envelope) {
  const base64Content = bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
  const blobSha = await createGitBlob(base64Content);
  let parentSha = await getBranchHeadSha();
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const baseTreeSha = await getCommitTreeSha(parentSha);
      const treeSha = await createGitTree(baseTreeSha, blobSha);
      const commitSha = await createGitCommit(treeSha, parentSha);
      await updateBranchHead(commitSha);
      const latest = await fetchEncryptedStore();
      return latest.sha;
    } catch (error) {
      lastError = error;
      if (!isGitHubShaConflict(error) || attempt >= 4) {
        throw error;
      }
      parentSha = await getBranchHeadSha();
    }
  }

  throw lastError || new Error("تعذّر حفظ المستندات على GitHub.");
}

async function putEncryptedStoreContents(envelope, sha) {
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
    throw await parseGitHubError(res);
  }

  const result = await res.json();
  return result.content.sha;
}

async function putEncryptedStore(envelope, sha) {
  const encoded = bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
  if (encoded.length > CONTENTS_PUT_LIMIT_BYTES) {
    return putEncryptedStoreViaGit(envelope);
  }
  return putEncryptedStoreContents(envelope, sha);
}

export async function uploadEncryptedStore(envelope, sha) {
  const encoded = bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
  if (encoded.length > CONTENTS_PUT_LIMIT_BYTES) {
    return putEncryptedStoreViaGit(envelope);
  }

  let currentSha = sha;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await putEncryptedStoreContents(envelope, currentSha);
    } catch (error) {
      lastError = error;
      if (!isGitHubShaConflict(error) || attempt >= 4) {
        if (encoded.length > CONTENTS_PUT_LIMIT_BYTES / 2) {
          return putEncryptedStoreViaGit(envelope);
        }
        throw error;
      }
      const latest = await fetchEncryptedStore();
      currentSha = latest.sha;
    }
  }

  throw lastError || new Error("تعذّر حفظ المستندات على GitHub.");
}
