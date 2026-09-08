import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_TOKEN,
  CHANGELOG_PATH,
} from "./config.js";
import { isGitHubShaConflict } from "./github-errors.js";

const LOCAL_KEY = "docshelf_site_changelog_local";

const DEFAULT_SETTINGS = {
  enabled: true,
  visibleTo: "all",
  maxVisible: 6,
  title: "تحديثات الموقع",
  language: "ar",
  tone: "brief",
  includeCategories: {
    feature: true,
    fix: true,
    ui: true,
    smpc: true,
    auth: false,
    storage: false,
    other: true,
  },
  includeFileList: false,
  includeCommitHash: false,
  autoPublish: true,
  requireAdminApproval: false,
  template: "{{title}}\n{{body}}",
  agentInstructions:
    "اكتب ملاحظة قصيرة بالعربية موجّهة للمستخدم النهائي: ماذا تغيّر وكيف يستفيد منه. لا تذكر مسارات ملفات أو تفاصيل تقنية إلا إذا فعّل المسؤول «إظهار قائمة الملفات». لا تكتب ملاحظات لفئات معطّلة في لوحة التحكم.",
};

export const CHANGELOG_CATEGORIES = [
  { id: "feature", label: "ميزة جديدة" },
  { id: "fix", label: "إصلاح" },
  { id: "ui", label: "واجهة" },
  { id: "smpc", label: "SmPC" },
  { id: "auth", label: "حسابات / صلاحيات" },
  { id: "storage", label: "تخزين" },
  { id: "other", label: "أخرى" },
];

function apiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${CHANGELOG_PATH}`;
}

function rawUrl() {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${CHANGELOG_PATH}`;
}

function isConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO && CHANGELOG_PATH);
}

function canReadRemote() {
  return Boolean(GITHUB_OWNER && GITHUB_REPO && CHANGELOG_PATH);
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

function normalizeCategories(raw = {}) {
  const out = { ...DEFAULT_SETTINGS.includeCategories };
  for (const key of Object.keys(out)) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

export function normalizeChangelogDb(data) {
  const next = data && typeof data === "object" ? data : {};
  const settingsIn = next.settings && typeof next.settings === "object" ? next.settings : {};
  const maxVisible = Number(settingsIn.maxVisible);
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...settingsIn,
      maxVisible: Number.isFinite(maxVisible) && maxVisible > 0 ? Math.min(Math.round(maxVisible), 30) : 6,
      includeCategories: normalizeCategories(settingsIn.includeCategories),
      enabled: settingsIn.enabled !== false,
      includeFileList: Boolean(settingsIn.includeFileList),
      includeCommitHash: Boolean(settingsIn.includeCommitHash),
      autoPublish: settingsIn.autoPublish !== false,
      requireAdminApproval: Boolean(settingsIn.requireAdminApproval),
      visibleTo: ["all", "members", "admin"].includes(settingsIn.visibleTo)
        ? settingsIn.visibleTo
        : "all",
      language: ["ar", "en", "both"].includes(settingsIn.language) ? settingsIn.language : "ar",
      tone: ["brief", "detailed"].includes(settingsIn.tone) ? settingsIn.tone : "brief",
      title: String(settingsIn.title || DEFAULT_SETTINGS.title).trim() || DEFAULT_SETTINGS.title,
      template: String(settingsIn.template || DEFAULT_SETTINGS.template),
      agentInstructions: String(settingsIn.agentInstructions || DEFAULT_SETTINGS.agentInstructions),
    },
    entries: Array.isArray(next.entries)
      ? next.entries
          .map((entry) => normalizeEntry(entry))
          .filter(Boolean)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      : [],
  };
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const title = String(raw.title || "").trim();
  const body = String(raw.body || "").trim();
  if (!id || (!title && !body)) return null;
  const category = CHANGELOG_CATEGORIES.some((item) => item.id === raw.category)
    ? raw.category
    : "other";
  return {
    id,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    author: String(raw.author || "admin").trim() || "admin",
    category,
    title,
    body,
    published: raw.published !== false,
    source: String(raw.source || "manual").trim() || "manual",
    files: Array.isArray(raw.files) ? raw.files.map(String).filter(Boolean).slice(0, 40) : [],
    commit: String(raw.commit || "").trim(),
  };
}

export function createChangelogEntry(partial = {}) {
  const now = new Date().toISOString();
  return normalizeEntry({
    id: partial.id || `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    author: partial.author || "admin",
    category: partial.category || "other",
    title: partial.title || "",
    body: partial.body || "",
    published: partial.published !== false,
    source: partial.source || "manual",
    files: partial.files || [],
    commit: partial.commit || "",
  });
}

export function categoryAllowed(settings, category) {
  const cats = settings?.includeCategories || {};
  return cats[category] !== false;
}

export function getVisibleEntries(db, { isAdmin = false, isMember = true } = {}) {
  const data = normalizeChangelogDb(db);
  if (!data.settings.enabled) return [];
  if (data.settings.visibleTo === "admin" && !isAdmin) return [];
  if (data.settings.visibleTo === "members" && !isMember && !isAdmin) return [];

  return data.entries
    .filter((entry) => entry.published)
    .filter((entry) => categoryAllowed(data.settings, entry.category))
    .slice(0, data.settings.maxVisible);
}

async function fetchChangelogFromRaw() {
  const res = await fetch(rawUrl(), { cache: "no-store" });
  if (res.status === 404) return normalizeChangelogDb({ settings: DEFAULT_SETTINGS, entries: [] });
  if (!res.ok) throw new Error(`تعذّر تحميل سجل التحديثات (${res.status})`);
  return normalizeChangelogDb(await res.json());
}

function readLocalChangelog() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return normalizeChangelogDb({ settings: DEFAULT_SETTINGS, entries: [] });
    return normalizeChangelogDb(JSON.parse(raw));
  } catch {
    return normalizeChangelogDb({ settings: DEFAULT_SETTINGS, entries: [] });
  }
}

let changelogSha = null;

export async function loadChangelogDb() {
  if (!canReadRemote()) return readLocalChangelog();
  if (!isConfigured()) return fetchChangelogFromRaw();

  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (res.status === 404) {
    const initial = normalizeChangelogDb({ settings: DEFAULT_SETTINGS, entries: [] });
    await saveChangelogDb(initial, null);
    return initial;
  }

  if (!res.ok) {
    try {
      return await fetchChangelogFromRaw();
    } catch {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `تعذّر تحميل سجل التحديثات (${res.status})`);
    }
  }

  const payload = await res.json();
  changelogSha = payload.sha;
  return normalizeChangelogDb(JSON.parse(decodeContent(payload.content)));
}

export async function refreshChangelogSha() {
  if (!isConfigured()) return;
  const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (res.ok) {
    const payload = await res.json();
    changelogSha = payload.sha;
  }
}

export async function saveChangelogDb(db, sha = changelogSha) {
  const payload = normalizeChangelogDb(db);
  if (!isConfigured()) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload, null, 2));
    return payload;
  }

  let currentSha = sha;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!currentSha) {
      await refreshChangelogSha();
      currentSha = changelogSha;
    }

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
    const body = {
      message: "Update site changelog",
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
      changelogSha = result.content.sha;
      return payload;
    }

    const err = await res.json().catch(() => ({}));
    const message = String(err.message || "");
    if (/not accessible by personal access token/i.test(message)) {
      throw new Error(
        "مفتاح GitHub لا يملك صلاحية الكتابة على المستودع. حدّث DOCSHELF_GITHUB_TOKEN بصلاحية Contents: Read and write ثم أعد النشر."
      );
    }

    const error = new Error(message || `تعذّر حفظ سجل التحديثات (${res.status})`);
    error.status = res.status;
    lastError = error;

    if (!isGitHubShaConflict(error) || attempt >= 2) throw error;
    await refreshChangelogSha();
    currentSha = changelogSha;
  }

  throw lastError || new Error("تعذّر حفظ سجل التحديثات.");
}

export function getDefaultChangelogSettings() {
  return normalizeChangelogDb({ settings: DEFAULT_SETTINGS, entries: [] }).settings;
}
