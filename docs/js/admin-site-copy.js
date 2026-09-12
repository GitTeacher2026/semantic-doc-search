import {
  SITE_COPY_CATALOG,
  applySiteCopy,
  captureDefaultSiteCopy,
  getCatalogItem,
  loadSiteCopyDbWithSha,
  normalizeSiteCopyDb,
  resolveEntryText,
  saveSiteCopyDb,
} from "./site-copy-store.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function initAdminSiteCopy({ getActor, onStatus, isAdmin }) {
  const openBtn = document.getElementById("open-site-copy-btn");
  const dialog = document.getElementById("site-copy-dialog");
  const backdrop = document.getElementById("site-copy-dialog-backdrop");
  const closeBtn = document.getElementById("site-copy-close-btn");
  const listEl = document.getElementById("site-copy-list");
  const editorEl = document.getElementById("site-copy-editor");
  const titleEl = document.getElementById("site-copy-editor-title");
  const descEl = document.getElementById("site-copy-editor-desc");
  const textEl = document.getElementById("site-copy-text");
  const visibleEl = document.getElementById("site-copy-visible");
  const saveBtn = document.getElementById("site-copy-save-btn");
  const resetBtn = document.getElementById("site-copy-reset-btn");
  const hideBtn = document.getElementById("site-copy-hide-btn");

  let db = normalizeSiteCopyDb({ entries: {} });
  let sha = null;
  let defaults = {};
  let selectedId = null;

  function ensureDefaults() {
    if (!Object.keys(defaults).length) {
      defaults = captureDefaultSiteCopy();
    }
  }

  async function refresh() {
    ensureDefaults();
    const loaded = await loadSiteCopyDbWithSha();
    db = loaded.db;
    sha = loaded.sha;
    applySiteCopy(db, defaults);
  }

  function knownIds() {
    const ids = new Set(SITE_COPY_CATALOG.map((item) => item.id));
    document.querySelectorAll("[data-site-copy]").forEach((el) => {
      const id = el.getAttribute("data-site-copy");
      if (id) ids.add(id);
    });
    Object.keys(db.entries || {}).forEach((id) => ids.add(id));
    return [...ids];
  }

  function entryStatus(id) {
    const entry = db.entries[id];
    if (!entry) return "افتراضي";
    if (entry.visible === false) return "مخفي";
    if (String(entry.text || "").trim()) return "معدّل";
    return "افتراضي";
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = knownIds()
      .map((id) => {
        const meta = getCatalogItem(id);
        return `<button type="button" class="site-copy-item ${
          selectedId === id ? "is-active" : ""
        }" data-id="${escapeHtml(id)}">
          <span class="site-copy-item-label">${escapeHtml(meta.label)}</span>
          <span class="site-copy-item-status">${escapeHtml(entryStatus(id))}</span>
        </button>`;
      })
      .join("");
  }

  function selectEntry(id) {
    selectedId = id;
    const meta = getCatalogItem(id);
    const entry = db.entries[id] || { text: "", visible: true };
    if (titleEl) titleEl.textContent = meta.label;
    if (descEl) descEl.textContent = meta.description;
    if (textEl) textEl.value = resolveEntryText(entry, defaults, id);
    if (visibleEl) visibleEl.checked = entry.visible !== false;
    renderList();
    editorEl?.classList.remove("hidden");
  }

  function openDialog() {
    if (!isAdmin?.()) return;
    ensureDefaults();
    renderList();
    if (!selectedId) {
      const first = knownIds()[0];
      if (first) selectEntry(first);
    } else {
      selectEntry(selectedId);
    }
    dialog?.classList.remove("hidden");
  }

  function closeDialog() {
    dialog?.classList.add("hidden");
  }

  async function persist(nextDb, message) {
    await saveSiteCopyDb(nextDb, sha);
    const loaded = await loadSiteCopyDbWithSha();
    db = loaded.db;
    sha = loaded.sha;
    applySiteCopy(db, defaults);
    renderList();
    if (selectedId) selectEntry(selectedId);
    onStatus?.(message, true);
  }

  async function saveSelected() {
    if (!selectedId) return;
    const actor = getActor?.();
    const next = normalizeSiteCopyDb(db);
    next.entries[selectedId] = {
      id: selectedId,
      text: String(textEl?.value || "").trim(),
      visible: visibleEl?.checked !== false,
      updatedAt: new Date().toISOString(),
      updatedBy: actor?.username || actor?.email || "admin",
    };
    await persist(next, "تم حفظ نص الموقع.");
  }

  async function resetSelected() {
    if (!selectedId) return;
    const next = normalizeSiteCopyDb(db);
    delete next.entries[selectedId];
    await persist(next, "تمت استعادة النص الافتراضي.");
  }

  async function hideSelected() {
    if (!selectedId) return;
    const actor = getActor?.();
    const next = normalizeSiteCopyDb(db);
    next.entries[selectedId] = {
      id: selectedId,
      text: "",
      visible: false,
      updatedAt: new Date().toISOString(),
      updatedBy: actor?.username || actor?.email || "admin",
    };
    await persist(next, "تم إخفاء النص من الموقع.");
  }

  openBtn?.addEventListener("click", () => {
    refresh()
      .then(openDialog)
      .catch((error) => onStatus?.(error.message, true));
  });
  closeBtn?.addEventListener("click", closeDialog);
  backdrop?.addEventListener("click", closeDialog);
  listEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-id]");
    if (!btn) return;
    selectEntry(btn.getAttribute("data-id"));
  });
  saveBtn?.addEventListener("click", () => {
    saveSelected().catch((error) => onStatus?.(error.message, true));
  });
  resetBtn?.addEventListener("click", () => {
    resetSelected().catch((error) => onStatus?.(error.message, true));
  });
  hideBtn?.addEventListener("click", () => {
    hideSelected().catch((error) => onStatus?.(error.message, true));
  });

  refresh().catch(() => {
    /* keep HTML defaults if remote copy is unavailable */
  });

  return {
    refresh,
    open: openDialog,
    close: closeDialog,
  };
}
