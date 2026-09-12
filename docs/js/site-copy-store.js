import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  SITE_COPY_PATH,
} from "./config.js";
import { isGitHubShaConflict } from "./github-errors.js";

const LOCAL_KEY = "docshelf_site_copy_local";

/** Known site blurbs that admins can edit or hide. */
export const SITE_COPY_CATALOG = [
  {
    id: "hero-tagline",
    label: "شعار الصفحة الرئيسية",
    description: "الجملة تحت عنوان الموقع بعد تسجيل الدخول.",
  },
  {
    id: "mega-connect-hint",
    label: "تلميح اتصال MEGA",
    description: "النص الظاهر في لوحة اتصال MEGA الاختيارية.",
  },
  {
    id: "mega-login-note",
    label: "ملاحظة تسجيل MEGA",
    description: "الملاحظة أسفل حقول بريد وكلمة مرور MEGA.",
  },
  {
    id: "pending-images-note",
    label: "ملاحظة الصور المعلّقة",
    description: "تنبيه متطلبات تسمية الصور قبل الفهرسة.",
  },
  {
    id: "pharma-search-intro",
    label: "مقدمة بحث الدساتير",
    description: "النص التوضيحي أعلى بحث monographs.",
  },
  {
    id: "pharma-search-credit",
    label: "مصدر فهرس الدساتير",
    description: "سطر نسب الفهرس أسفل بحث الدساتير.",
  },
  {
    id: "smpc-search-intro",
    label: "مقدمة بحث SmPC",
    description: "النص التوضيحي أعلى بحث نشرات خصائص المنتج.",
  },
  {
    id: "smpc-filters-hint",
    label: "تلميح فلاتر SmPC",
    description: "شرح كيفية عمل فلاتر البحث المتقدم لـ SmPC.",
  },
  {
    id: "cert-search-intro",
    label: "مقدمة بحث الشهادات",
    description: "النص التوضيحي أعلى بحث شهادات ISO / اعتماد الشركات.",
  },
];

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${SITE_COPY_PATH}`;
}

function rawUrl() {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${SITE_COPY_PATH}`;
}

function isConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && SITE_COPY_PATH);
}

function canReadRemote() {
  return Boolean(GITHUB_OWNER && GITHUB_REPO && SITE_COPY_PATH);
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

function normalizeEntry(id, raw = {}) {
  return {
    id,
    text: typeof raw.text === "string" ? raw.text : "",
    visible: raw.visible !== false,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

export function normalizeSiteCopyDb(data) {
  const next = data && typeof data === "object" ? data : {};
  const source = next.entries && typeof next.entries === "object" ? next.entries : {};
  const entries = {};

  for (const item of SITE_COPY_CATALOG) {
    if (Object.prototype.hasOwnProperty.call(source, item.id)) {
      entries[item.id] = normalizeEntry(item.id, source[item.id]);
    }
  }

  for (const [id, value] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(entries, id)) {
      entries[id] = normalizeEntry(id, value);
    }
  }

  return { entries };
}

export function getCatalogItem(id) {
  return (
    SITE_COPY_CATALOG.find((item) => item.id === id) || {
      id,
      label: id,
      description: "نص مخصّص على الصفحة.",
    }
  );
}

function emptyDb() {
  return { entries: {} };
}

async function fetchFromRaw() {
  const res = await fetch(rawUrl(), { cache: "no-store" });
  if (res.status === 404) return emptyDb();
  if (!res.ok) throw new Error(`تعذّر تحميل نصوص الموقع (${res.status})`);
  return normalizeSiteCopyDb(await res.json());
}

let siteCopySha = null;

export async function loadSiteCopyDb() {
  if (!canReadRemote()) {
    const local = localStorage.getItem(LOCAL_KEY);
    return normalizeSiteCopyDb(local ? JSON.parse(local) : emptyDb());
  }

  if (!isConfigured()) {
    return fetchFromRaw();
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 404) return emptyDb();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `تعذّر تحميل نصوص الموقع (${res.status})`);
  }

  const payload = await res.json();
  siteCopySha = payload.sha;
  return normalizeSiteCopyDb(JSON.parse(decodeContent(payload.content)));
}

export async function loadSiteCopyDbWithSha() {
  if (!canReadRemote()) {
    const local = localStorage.getItem(LOCAL_KEY);
    return {
      db: normalizeSiteCopyDb(local ? JSON.parse(local) : emptyDb()),
      sha: null,
    };
  }

  if (!isConfigured()) {
    return { db: await fetchFromRaw(), sha: null };
  }

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 404) {
    return { db: emptyDb(), sha: null };
  }

  if (!res.ok) {
    return { db: await fetchFromRaw(), sha: siteCopySha };
  }

  const payload = await res.json();
  siteCopySha = payload.sha;
  return {
    db: normalizeSiteCopyDb(JSON.parse(decodeContent(payload.content))),
    sha: siteCopySha,
  };
}

export async function refreshSiteCopySha() {
  if (!isConfigured()) return;
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.ok) {
    const payload = await res.json();
    siteCopySha = payload.sha;
  } else if (res.status === 404) {
    siteCopySha = null;
  }
}

export async function saveSiteCopyDb(db, sha = siteCopySha) {
  const payload = normalizeSiteCopyDb(db);
  if (!isConfigured()) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
    siteCopySha = null;
    return;
  }

  let currentSha = sha;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!currentSha && attempt === 0) {
      await refreshSiteCopySha();
      currentSha = siteCopySha;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
    const body = {
      message: "Update site copy",
      content,
      branch: GITHUB_BRANCH,
    };
    if (currentSha) body.sha = currentSha;

    const res = await fetch(apiUrl(), {
      method: "PUT",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const result = await res.json();
      siteCopySha = result.content?.sha || null;
      return;
    }

    const err = await res.json().catch(() => ({}));
    const message = String(err.message || "");
    if (/not accessible by personal access token/i.test(message)) {
      throw new Error(
        "مفتاح GitHub لا يملك صلاحية الكتابة على المستودع. حدّث DOCSHELF_GITHUB_TOKEN بصلاحية Contents: Read and write ثم أعد النشر."
      );
    }

    const error = new Error(message || `تعذّر حفظ نصوص الموقع (${res.status})`);
    error.status = res.status;
    lastError = error;

    if (!isGitHubShaConflict(error) || attempt >= 2) {
      throw error;
    }

    await refreshSiteCopySha();
    currentSha = siteCopySha;
  }

  throw lastError || new Error("تعذّر حفظ نصوص الموقع.");
}

export function captureDefaultSiteCopy() {
  const defaults = {};
  for (const el of document.querySelectorAll("[data-site-copy]")) {
    const id = el.getAttribute("data-site-copy");
    if (!id) continue;
    if (!el.dataset.siteCopyDefault) {
      el.dataset.siteCopyDefault = el.innerHTML.trim();
    }
    defaults[id] = {
      html: el.dataset.siteCopyDefault,
      text: el.innerText.replace(/\s+/g, " ").trim(),
    };
  }
  return defaults;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Allow only a tiny safe subset so admins can keep bold/links. */
export function sanitizeSiteCopyHtml(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (!/<[a-z][\s\S]*>/i.test(raw)) {
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }

  const template = document.createElement("template");
  template.innerHTML = raw;
  const allowed = new Set(["STRONG", "B", "EM", "I", "A", "BR", "P", "SPAN"]);

  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      if (child.tagName === "A") {
        const href = child.getAttribute("href") || "";
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        if (/^https?:\/\//i.test(href)) {
          child.setAttribute("href", href);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        }
      } else {
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
      }
      walk(child);
    });
  };

  walk(template.content);
  return template.innerHTML.trim();
}

export function applySiteCopy(db, defaults = {}) {
  const entries = normalizeSiteCopyDb(db).entries;

  for (const el of document.querySelectorAll("[data-site-copy]")) {
    const id = el.getAttribute("data-site-copy");
    if (!id) continue;

    if (!el.dataset.siteCopyDefault) {
      el.dataset.siteCopyDefault = (defaults[id]?.html || el.innerHTML).trim();
    }

    const entry = entries[id];
    if (!entry) {
      el.innerHTML = el.dataset.siteCopyDefault;
      el.classList.remove("hidden");
      continue;
    }

    if (entry.visible === false) {
      el.innerHTML = "";
      el.classList.add("hidden");
      continue;
    }

    const text = String(entry.text || "").trim();
    if (text) {
      el.innerHTML = sanitizeSiteCopyHtml(text);
      el.classList.remove("hidden");
      continue;
    }

    el.innerHTML = el.dataset.siteCopyDefault;
    el.classList.remove("hidden");
  }
}

export function resolveEntryText(entry, defaults, id) {
  if (entry && String(entry.text || "").trim()) return entry.text;
  return defaults[id]?.text || stripTags(defaults[id]?.html || "") || "";
}

function stripTags(html) {
  const el = document.createElement("div");
  el.innerHTML = html || "";
  return el.innerText.replace(/\s+/g, " ").trim();
}
