import {
  GROUP_ICONS,
  GROUP_LABELS,
  fileGroup,
} from "./constants.js";
import { isImageFile } from "./ocr.js";
import {
  STORAGE_BACKENDS,
  documentHasStorageBackend,
  getDocumentStoragePath,
  getStorageBackendIcon,
  getStorageBackendLabel,
  listDocumentStorageBackends,
} from "./document-storage.js";

const BROWSER_STATE_KEY = "docshelf_file_browser_v3";
const SIDEBAR_WIDTH_KEY = "docshelf_fb_sidebar_width";
const SIDEBAR_WIDTH_DEFAULT = 260;
const SIDEBAR_WIDTH_MIN = 160;
const SIDEBAR_WIDTH_MAX = 520;

const DEFAULT_STATE = {
  storage: null,
  category: null,
  group: null,
  query: "",
  sort: "name",
};

let browserState = loadBrowserState();
let rootElement = null;
let actionHandlers = {};
let browserOptions = {};
let folderRecords = [];

const DOC_DRAG_TYPE = "application/x-docshelf-doc-id";

function isFolderLocked(name) {
  const folder = folderRecords.find((item) => item.name === name);
  return Boolean(folder?.isLocked);
}

function canAccessFolder(name) {
  if (!name) return true;
  if (!isFolderLocked(name)) return true;
  return actionHandlers.isFolderUnlocked?.(name) === true;
}

function isDocumentAccessible(doc) {
  const category = doc.category || "عام";
  return canAccessFolder(category);
}

function loadBrowserState() {
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSER_STATE_KEY) || "{}");
    return { ...DEFAULT_STATE, ...saved };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveBrowserState() {
  localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(browserState));
}

export function getFileBrowserState() {
  return { ...browserState };
}

export function setFileBrowserState(patch) {
  browserState = { ...browserState, ...patch };
  saveBrowserState();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function getStorageFilteredDocuments(documents) {
  return documents;
}

function getVisibleDocuments(documents) {
  return getStorageFilteredDocuments(documents).filter((doc) => isDocumentAccessible(doc));
}

function filterDocuments(documents) {
  const query = normalizeQuery(browserState.query);
  let list = getVisibleDocuments(documents);

  if (browserState.storage) {
    list = list.filter((doc) => documentHasStorageBackend(doc, browserState.storage));
  }
  if (browserState.category) {
    list = list.filter((doc) => (doc.category || "عام") === browserState.category);
  }
  if (browserState.group) {
    list = list.filter((doc) => (doc.fileGroup || fileGroup(doc.filename)) === browserState.group);
  }
  if (query) {
    list = list.filter((doc) => {
      const haystack = [
        doc.filename,
        doc.category,
        doc.preview,
        getDocumentStoragePath(doc),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return sortDocuments(list);
}

function sortDocuments(documents) {
  const sorted = [...documents];
  if (browserState.sort === "size") {
    sorted.sort((a, b) => (b.charCount || 0) - (a.charCount || 0));
  } else if (browserState.sort === "category") {
    sorted.sort(
      (a, b) =>
        (a.category || "").localeCompare(b.category || "", "ar") ||
        a.filename.localeCompare(b.filename, "ar")
    );
  } else {
    sorted.sort((a, b) => a.filename.localeCompare(b.filename, "ar"));
  }
  return sorted;
}

function collectNavData(documents) {
  const storageFiltered = getStorageFilteredDocuments(documents);
  const storages = new Map();
  const categories = new Map();
  const groups = new Map();

  for (const doc of storageFiltered) {
    const backends = listDocumentStorageBackends(doc);
    const category = doc.category || "عام";
    const group = doc.fileGroup || fileGroup(doc.filename);

    for (const storage of backends) {
      storages.set(storage, (storages.get(storage) || 0) + 1);
    }
    categories.set(category, (categories.get(category) || 0) + 1);
    const groupKey = `${category}::${group}`;
    groups.set(groupKey, (groups.get(groupKey) || 0) + 1);
  }

  if (browserOptions.dualSources) {
    for (const storage of [STORAGE_BACKENDS.GITHUB, STORAGE_BACKENDS.MEGA]) {
      if (!storages.has(storage)) storages.set(storage, 0);
    }
  }

  for (const folder of folderRecords) {
    const category = folder?.name;
    if (!category || categories.has(category)) continue;
    const count = storageFiltered.filter((doc) => (doc.category || "عام") === category).length;
    categories.set(category, count);
  }

  return {
    total: storageFiltered.length,
    storages: [...storages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar")),
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar")),
    groups,
  };
}

function getBreadcrumbs() {
  const crumbs = [{ id: "root", label: "كل الملفات" }];
  if (browserState.storage) {
    crumbs.push({
      id: `storage:${browserState.storage}`,
      label: getStorageBackendLabel(browserState.storage),
    });
  }
  if (browserState.category) {
    crumbs.push({ id: `category:${browserState.category}`, label: browserState.category });
  }
  if (browserState.group) {
    crumbs.push({
      id: `group:${browserState.group}`,
      label: GROUP_LABELS[browserState.group] || browserState.group,
    });
  }
  return crumbs;
}

function navigateToCrumb(crumbId) {
  if (crumbId === "root") {
    setFileBrowserState({ storage: null, category: null, group: null });
    return;
  }
  if (crumbId.startsWith("storage:")) {
    setFileBrowserState({
      storage: crumbId.slice(8),
      category: null,
      group: null,
    });
    return;
  }
  if (crumbId.startsWith("category:")) {
    setFileBrowserState({
      category: crumbId.slice(9),
      group: null,
    });
    return;
  }
}

function isImageDocument(doc) {
  return isImageFile(doc?.filename) || doc?.fileGroup === "image";
}

function hasExtractedOcr(doc) {
  return doc?.ocrExtracted === true;
}

function formatDocSizeLabel(doc) {
  if (isImageDocument(doc) && !hasExtractedOcr(doc)) {
    return "بدون نص مستخرج";
  }
  return `${doc.charCount?.toLocaleString("ar-EG") || 0} حرف`;
}

function renderOcrAction(doc, { compact = false } = {}) {
  if (!isImageDocument(doc)) return "";
  const title = hasExtractedOcr(doc) ? "إعادة استخراج النص" : "استخراج النص من الصورة";
  const label = hasExtractedOcr(doc) ? "إعادة الاستخراج" : "استخراج نص";
  if (compact) {
    return `<button class="btn ghost small ocr-btn" data-id="${doc.id}" type="button" title="${title}">📝</button>`;
  }
  return `<button class="btn ghost small ocr-btn" data-id="${doc.id}" type="button">${label}</button>`;
}

function renderDocActions(doc) {
  const locked = doc.isLocked;
  const unlocked = actionHandlers.isDocUnlocked?.(doc);
  const lockBtn = locked
    ? `<button class="btn ghost small unlock-btn" data-id="${doc.id}" type="button" title="${unlocked ? "إعادة القفل" : "فتح"}">${unlocked ? "🔒" : "🔓"}</button>`
    : `<button class="btn ghost small lock-btn" data-id="${doc.id}" type="button" title="قفل">🔒</button>`;

  return `
    <div class="fb-card-actions">
      ${renderOcrAction(doc, { compact: true })}
      <button class="btn ghost small download-btn" data-id="${doc.id}" type="button" title="تنزيل">⬇</button>
      <button class="btn ghost small rename-btn" data-id="${doc.id}" type="button" title="إعادة تسمية">✏️</button>
      ${lockBtn}
      <button class="btn ghost small delete-btn" data-id="${doc.id}" type="button" title="حذف">🗑</button>
    </div>`;
}

function renderStorageBadges(doc) {
  return listDocumentStorageBackends(doc)
    .map(
      (storage) =>
        `<span class="storage-badge storage-${storage}">${getStorageBackendIcon(storage)} ${escapeHtml(getStorageBackendLabel(storage))}</span>`
    )
    .join("");
}

function shouldRenderSplitSources() {
  return (
    browserOptions.dualSources &&
    !browserState.storage &&
    !browserState.category &&
    !browserState.group &&
    !normalizeQuery(browserState.query)
  );
}

function renderSourceSection(title, icon, storage, docs) {
  if (!docs.length) {
    return `
      <section class="fb-source-section">
        <header class="fb-source-header">
          <h3>${icon} ${escapeHtml(title)}</h3>
          <span class="muted">0 ملف</span>
        </header>
        <p class="fb-source-empty muted">لا توجد ملفات في هذا المصدر.</p>
      </section>`;
  }

  const content = `<div class="fb-grid">${docs.map((doc) => renderGridItem(doc)).join("")}</div>`;

  return `
    <section class="fb-source-section" data-source-section="${storage}">
      <header class="fb-source-header">
        <h3>${icon} ${escapeHtml(title)}</h3>
        <span class="muted">${docs.length.toLocaleString("ar-EG")} ملف</span>
      </header>
      <div class="fb-source-content" data-drop-category="">${content}</div>
    </section>`;
}

function renderSplitSourceContent(filtered) {
  const githubDocs = filtered.filter((doc) => documentHasStorageBackend(doc, STORAGE_BACKENDS.GITHUB));
  const megaDocs = filtered.filter((doc) => documentHasStorageBackend(doc, STORAGE_BACKENDS.MEGA));
  return `
    <div class="fb-source-split">
      ${renderSourceSection("GitHub", getStorageBackendIcon(STORAGE_BACKENDS.GITHUB), STORAGE_BACKENDS.GITHUB, githubDocs)}
      ${renderSourceSection("MEGA", getStorageBackendIcon(STORAGE_BACKENDS.MEGA), STORAGE_BACKENDS.MEGA, megaDocs)}
    </div>`;
}

function renderImageThumb(doc) {
  return `
    <button
      type="button"
      class="fb-card-thumb image-preview-btn"
      data-id="${doc.id}"
      aria-label="معاينة ${escapeHtml(doc.filename)}"
    >
      <span class="fb-card-thumb-placeholder" aria-hidden="true">🖼️</span>
    </button>`;
}

function renderGridItem(doc) {
  const groupName = doc.fileGroup || fileGroup(doc.filename);
  const lockedClass = doc.isLocked ? " is-locked" : "";
  const imageClass = isImageDocument(doc) ? " is-image" : "";
  const visual = isImageDocument(doc)
    ? renderImageThumb(doc)
    : `<div class="fb-card-icon" aria-hidden="true">${GROUP_ICONS[groupName] || GROUP_ICONS.other}</div>`;
  return `
    <article class="fb-card fb-draggable${lockedClass}${imageClass}" draggable="true" data-doc-id="${doc.id}" data-id="${doc.id}">
      ${visual}
      <div class="fb-card-body">
        <h3 class="fb-card-title" title="${escapeHtml(doc.filename)}">${escapeHtml(doc.filename)}</h3>
        <p class="fb-card-meta muted">${escapeHtml(doc.category || "عام")} · ${formatDocSizeLabel(doc)}</p>
        <div class="fb-card-badges">
          ${renderStorageBadges(doc)}
          ${isImageDocument(doc) && !hasExtractedOcr(doc) ? '<span class="ocr-badge">بدون نص</span>' : ""}
          ${isImageDocument(doc) && doc.imageComment ? '<span class="comment-badge" title="يوجد تعليق">💬 تعليق</span>' : ""}
          ${doc.isLocked ? '<span class="lock-badge">🔒 مقفل</span>' : ""}
        </div>
      </div>
      ${renderDocActions(doc)}
    </article>`;
}

function renderFolderActions(category) {
  const locked = isFolderLocked(category);
  const unlocked = actionHandlers.isFolderUnlocked?.(category);
  const lockTitle = locked ? (unlocked ? "إعادة قفل المجلد" : "فتح المجلد") : "قفل المجلد";
  const lockIcon = locked ? (unlocked ? "🔒" : "🔓") : "🔒";
  const lockAction = locked ? (unlocked ? "folder-relock" : "folder-unlock") : "folder-lock";
  return `
    <div class="fb-folder-actions">
      <button class="fb-folder-action-btn" type="button" data-folder-action="rename" data-folder="${escapeHtml(category)}" title="إعادة تسمية المجلد">✏️</button>
      <button class="fb-folder-action-btn" type="button" data-folder-action="${lockAction}" data-folder="${escapeHtml(category)}" title="${lockTitle}">${lockIcon}</button>
      <button class="fb-folder-action-btn danger" type="button" data-folder-action="delete" data-folder="${escapeHtml(category)}" title="حذف المجلد">🗑</button>
    </div>`;
}

function renderSidebar(navData) {
  const activeStorage = browserState.storage;
  const activeCategory = browserState.category;

  const storageItems = navData.storages
    .map(
      ([storage, count]) => `
      <button class="fb-nav-item${activeStorage === storage && !activeCategory ? " active" : ""}" type="button" data-nav="storage" data-value="${storage}">
        <span class="fb-nav-icon">${getStorageBackendIcon(storage)}</span>
        <span class="fb-nav-label">${escapeHtml(getStorageBackendLabel(storage))}</span>
        <span class="fb-nav-count">${count}</span>
      </button>`
    )
    .join("");

  const categoryItems = navData.categories
    .map(([category, count]) => {
      const locked = isFolderLocked(category);
      const unlocked = actionHandlers.isFolderUnlocked?.(category);
      const needsUnlock = locked && !unlocked;
      return `
      <div class="fb-folder-row${activeCategory === category ? " active" : ""}${needsUnlock ? " is-locked" : ""}" data-drop-category="${escapeHtml(category)}">
        <button class="fb-nav-item${activeCategory === category ? " active" : ""}" type="button" data-nav="category" data-value="${escapeHtml(category)}" data-locked="${needsUnlock ? "1" : "0"}">
          <span class="fb-nav-icon">${locked ? "🔒" : "📁"}</span>
          <span class="fb-nav-label">${escapeHtml(category)}</span>
          <span class="fb-nav-count">${count}</span>
        </button>
        ${renderFolderActions(category)}
      </div>`;
    })
    .join("");

  return `
    <aside class="fb-sidebar" aria-label="تصفح المجلدات">
      <button class="fb-nav-item fb-nav-root${!activeStorage && !activeCategory ? " active" : ""}" type="button" data-nav="root">
        <span class="fb-nav-icon">🏠</span>
        <span class="fb-nav-label">كل الملفات</span>
        <span class="fb-nav-count">${navData.total}</span>
      </button>
      ${storageItems ? `<div class="fb-nav-section">مصادر التخزين</div>${storageItems}` : ""}
      <div class="fb-nav-section fb-nav-section-head">
        <span>التصنيفات</span>
        <button id="fb-create-folder-btn" class="btn ghost small fb-create-folder-btn" type="button" title="إنشاء مجلد جديد">+ مجلد</button>
      </div>
      ${categoryItems || `<p class="fb-nav-empty muted">لا توجد مجلدات بعد.</p>`}
    </aside>`;
}

function renderShell(sidebarHtml, mainHtml) {
  return `
    <div class="fb-shell">
      ${sidebarHtml}
      <div
        class="fb-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="تغيير عرض لوحة المجلدات"
        tabindex="0"
      ></div>
      <section class="fb-main">
        ${mainHtml}
      </section>
    </div>`;
}

function clampSidebarWidth(width, shellWidth = 0) {
  const max = shellWidth
    ? Math.min(SIDEBAR_WIDTH_MAX, Math.round(shellWidth * 0.55))
    : SIDEBAR_WIDTH_MAX;
  return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

function applySidebarWidth(shell, width) {
  if (!shell) return;
  shell.style.setProperty("--fb-sidebar-width", `${clampSidebarWidth(width, shell.clientWidth)}px`);
}

function bindSidebarResize(container) {
  const shell = container.querySelector(".fb-shell");
  const handle = container.querySelector(".fb-resize-handle");
  const sidebar = container.querySelector(".fb-sidebar");
  if (!shell || !handle || !sidebar) return;

  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (Number.isFinite(saved) && saved > 0) {
    applySidebarWidth(shell, saved);
  }

  let startX = 0;
  let startWidth = SIDEBAR_WIDTH_DEFAULT;

  const finishResize = () => {
    shell.classList.remove("is-resizing");
    document.body.classList.remove("fb-resizing");
    const width = sidebar.offsetWidth;
    if (width) {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };

  const onPointerMove = (event) => {
    const isRtl = getComputedStyle(shell).direction === "rtl";
    const delta = event.clientX - startX;
    const next = startWidth + (isRtl ? -delta : delta);
    applySidebarWidth(shell, next);
  };

  const onPointerUp = () => {
    finishResize();
  };

  handle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    event.preventDefault();
    startX = event.clientX;
    startWidth = sidebar.offsetWidth || SIDEBAR_WIDTH_DEFAULT;
    shell.classList.add("is-resizing");
    document.body.classList.add("fb-resizing");
    handle.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  });

  handle.addEventListener("dblclick", () => {
    applySidebarWidth(shell, SIDEBAR_WIDTH_DEFAULT);
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  });

  handle.addEventListener("keydown", (event) => {
    if (window.matchMedia("(max-width: 900px)").matches) return;
    const step = event.shiftKey ? 40 : 16;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const isRtl = getComputedStyle(shell).direction === "rtl";
      const grow = event.key === (isRtl ? "ArrowLeft" : "ArrowRight");
      applySidebarWidth(shell, sidebar.offsetWidth + (grow ? step : -step));
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebar.offsetWidth));
    }
    if (event.key === "Home") {
      event.preventDefault();
      applySidebarWidth(shell, SIDEBAR_WIDTH_DEFAULT);
      localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    }
  });
}

function renderToolbar(filteredCount, totalCount) {
  const crumbs = getBreadcrumbs();
  const sourceSummary = browserOptions.dualSources
    ? "من GitHub و MEGA"
    : "من كل المصادر";

  return `
    <div class="fb-toolbar">
      <nav class="fb-breadcrumbs" aria-label="مسار التصفح">
        ${crumbs
          .map(
            (crumb, index) => `
          <button class="fb-crumb${index === crumbs.length - 1 ? " current" : ""}" type="button" data-crumb="${crumb.id}">
            ${escapeHtml(crumb.label)}
          </button>`
          )
          .join('<span class="fb-crumb-sep" aria-hidden="true">›</span>')}
      </nav>
      <div class="fb-toolbar-actions">
        <label class="fb-search-wrap">
          <span class="sr-only">بحث في الملفات</span>
          <input id="fb-search-input" class="fb-search-input" type="search" placeholder="بحث في الملفات…" value="${escapeHtml(browserState.query)}" />
        </label>
        <label class="fb-select-wrap">
          <span class="sr-only">ترتيب</span>
          <select id="fb-sort-select" class="fb-select">
            <option value="name"${browserState.sort === "name" ? " selected" : ""}>الاسم</option>
            <option value="size"${browserState.sort === "size" ? " selected" : ""}>الحجم</option>
            <option value="category"${browserState.sort === "category" ? " selected" : ""}>التصنيف</option>
          </select>
        </label>
        ${browserOptions.syncAvailable ? `<button id="fb-sync-github-mega" class="btn ghost small" type="button" title="نسخ الملفات بين GitHub و MEGA">مزامنة GitHub ⟷ MEGA</button>` : ""}
      </div>
    </div>
    <p class="fb-summary muted">
      ${filteredCount.toLocaleString("ar-EG")} ملف
      ${sourceSummary}
      ${browserState.query ? `— نتائج «${escapeHtml(browserState.query)}»` : ""}
      · اسحب الملفات إلى المجلدات أو أفلتها من جهازك
    </p>`;
}

function renderContent(documents) {
  const filtered = filterDocuments(documents);
  const navData = collectNavData(documents);

  if (!documents.length && !folderRecords.length) {
    return renderShell(
      renderSidebar(navData),
      `
          ${renderToolbar(0, 0)}
          <div class="fb-empty">
            <div class="fb-empty-icon" aria-hidden="true">📂</div>
            <h3>لا توجد ملفات بعد</h3>
            <p class="muted">أنشئ مجلداً من الشريط الجانبي أو ارفع ملفات من صفحة الرفع والفهرسة.</p>
          </div>`
    );
  }

  if (browserState.category && !canAccessFolder(browserState.category)) {
    return renderShell(
      renderSidebar(navData),
      `
          ${renderToolbar(0, navData.total)}
          <div class="fb-empty">
            <div class="fb-empty-icon" aria-hidden="true">🔒</div>
            <h3>مجلد مقفل</h3>
            <p class="muted">أدخل كلمة مرور المجلد لعرض محتويات «${escapeHtml(browserState.category)}».</p>
            <button id="fb-unlock-folder-btn" class="btn primary" type="button" data-folder="${escapeHtml(browserState.category)}">فتح المجلد</button>
          </div>`
    );
  }

  if (!filtered.length) {
    const emptyTitle = browserState.query
      ? "لا توجد ملفات مطابقة"
      : browserState.category
        ? "المجلد فارغ"
        : "لا توجد ملفات";
    const emptyHint = browserState.query
      ? "جرّب تغيير البحث أو اختيار مجلد آخر من الشريط الجانبي."
      : browserState.category
        ? `لا توجد ملفات في «${escapeHtml(browserState.category)}» بعد. اسحب ملفات إلى هذا المجلد أو ارفعها من صفحة الرفع.`
        : "أنشئ مجلداً من الشريط الجانبي أو ارفع ملفات من صفحة الرفع والفهرسة.";
    return renderShell(
      renderSidebar(navData),
      `
          ${renderToolbar(0, navData.total)}
          <div class="fb-empty">
            <div class="fb-empty-icon" aria-hidden="true">${browserState.query ? "🔍" : "📂"}</div>
            <h3>${emptyTitle}</h3>
            <p class="muted">${emptyHint}</p>
          </div>`
    );
  }

  const content = shouldRenderSplitSources()
    ? renderSplitSourceContent(filtered)
    : `<div class="fb-grid">${filtered.map((doc) => renderGridItem(doc)).join("")}</div>`;

  return renderShell(
    renderSidebar(navData),
    `
        ${renderToolbar(filtered.length, navData.total)}
        <div class="fb-content" data-drop-category="${escapeHtml(browserState.category || "")}">${content}</div>`
  );
}

function bindActions(container) {
  container.querySelectorAll(".image-preview-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      actionHandlers.onImagePreview?.(btn.dataset.id);
    });
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
  });

  container.querySelectorAll(".ocr-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onOcr?.(btn.dataset.id));
  });
  container.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onDelete?.(btn.dataset.id));
  });
  container.querySelectorAll(".download-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onDownload?.(btn.dataset.id));
  });
  container.querySelectorAll(".rename-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onRename?.(btn.dataset.id));
  });
  container.querySelectorAll(".lock-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onLock?.(btn.dataset.id));
  });
  container.querySelectorAll(".unlock-btn").forEach((btn) => {
    btn.addEventListener("click", () => actionHandlers.onUnlock?.(btn.dataset.id));
  });
}

function bindFolderActions(container, onChange) {
  container.querySelectorAll("[data-folder-action]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const action = btn.dataset.folderAction;
      const folder = btn.dataset.folder;
      if (action === "rename") actionHandlers.onFolderRename?.(folder);
      else if (action === "delete") actionHandlers.onFolderDelete?.(folder);
      else if (action === "folder-lock") actionHandlers.onFolderLock?.(folder);
      else if (action === "folder-unlock") actionHandlers.onFolderUnlock?.(folder, onChange);
      else if (action === "folder-relock") actionHandlers.onFolderRelock?.(folder, onChange);
    });
  });

  container.querySelector("#fb-unlock-folder-btn")?.addEventListener("click", () => {
    const folder = container.querySelector("#fb-unlock-folder-btn")?.dataset.folder;
    if (folder) actionHandlers.onFolderUnlock?.(folder, onChange);
  });
}

function bindDragDrop(container, onChange) {
  container.querySelectorAll(".fb-draggable").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      const docId = element.dataset.docId;
      if (!docId) return;
      event.dataTransfer?.setData(DOC_DRAG_TYPE, docId);
      event.dataTransfer?.setData("text/plain", docId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      element.classList.add("is-dragging");
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("is-dragging");
      container.querySelectorAll(".fb-drop-target").forEach((el) => el.classList.remove("fb-drop-target"));
    });
  });

  const bindDropZone = (element) => {
    element.addEventListener("dragover", (event) => {
      const hasFiles = [...(event.dataTransfer?.types || [])].includes("Files");
      const hasDoc = [...(event.dataTransfer?.types || [])].includes(DOC_DRAG_TYPE);
      if (!hasFiles && !hasDoc) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = hasDoc ? "move" : "copy";
      element.classList.add("fb-drop-target");
    });
    element.addEventListener("dragleave", (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      element.classList.remove("fb-drop-target");
    });
    element.addEventListener("drop", async (event) => {
      event.preventDefault();
      element.classList.remove("fb-drop-target");
      const category = element.dataset.dropCategory || browserState.category || "";
      const docId = event.dataTransfer?.getData(DOC_DRAG_TYPE);
      const files = [...(event.dataTransfer?.files || [])];
      if (docId && category) {
        await actionHandlers.onDocumentMove?.(docId, category);
        onChange?.();
        return;
      }
      if (files.length) {
        await actionHandlers.onExternalDrop?.(files, category || null);
        onChange?.();
      }
    });
  };

  container.querySelectorAll("[data-drop-category]").forEach(bindDropZone);

  container.querySelector("#fb-sync-github-mega")?.addEventListener("click", () => {
    actionHandlers.onSyncGitHubMega?.();
  });
}

function bindNavigation(container, onChange) {
  container.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "category" && btn.dataset.locked === "1") {
        actionHandlers.onFolderUnlock?.(btn.dataset.value, () => {
          setFileBrowserState({ category: btn.dataset.value, group: null });
          onChange?.();
        });
        return;
      }
      if (nav === "root") {
        setFileBrowserState({ storage: null, category: null, group: null });
      } else if (nav === "storage") {
        setFileBrowserState({
          storage: btn.dataset.value,
          category: null,
          group: null,
        });
      } else if (nav === "category") {
        setFileBrowserState({
          category: btn.dataset.value,
          group: null,
        });
      }
      onChange?.();
    });
  });

  container.querySelectorAll("[data-crumb]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigateToCrumb(btn.dataset.crumb);
      onChange?.();
    });
  });

  container.querySelector("#fb-search-input")?.addEventListener("input", (event) => {
    setFileBrowserState({ query: event.target.value });
    onChange?.();
  });

  container.querySelector("#fb-sort-select")?.addEventListener("change", (event) => {
    setFileBrowserState({ sort: event.target.value });
    onChange?.();
  });

  container.querySelector("#fb-create-folder-btn")?.addEventListener("click", () => {
    actionHandlers.onFolderCreate?.();
  });
}

export function initFileBrowser(element, handlers = {}) {
  rootElement = element;
  actionHandlers = handlers;
}

export function renderFileBrowser(documents, options = {}) {
  if (!rootElement) return;
  browserOptions = options;
  folderRecords = options.folders || [];
  rootElement.innerHTML = renderContent(documents);
  bindActions(rootElement);
  bindFolderActions(rootElement, options.onChange);
  bindDragDrop(rootElement, options.onChange);
  bindNavigation(rootElement, options.onChange);
  bindSidebarResize(rootElement);
}

export function getFileCountLabel(documents) {
  const count = documents?.length || 0;
  return count ? `${count.toLocaleString("ar-EG")} ملف` : "لا توجد ملفات";
}
