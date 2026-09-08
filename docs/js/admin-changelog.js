import {
  CHANGELOG_CATEGORIES,
  createChangelogEntry,
  getVisibleEntries,
  loadChangelogDb,
  normalizeChangelogDb,
  saveChangelogDb,
} from "./site-changelog-store.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

function categoryLabel(id) {
  return CHANGELOG_CATEGORIES.find((item) => item.id === id)?.label || id;
}

function renderPublicFeed(entries, settings) {
  if (!entries.length) {
    return `<p class="muted site-changelog-empty">لا توجد تحديثات منشورة حالياً.</p>`;
  }
  return `
    <ul class="site-changelog-list">
      ${entries
        .map(
          (entry) => `
        <li class="site-changelog-item" data-category="${escapeHtml(entry.category)}">
          <div class="site-changelog-item-head">
            <span class="site-changelog-cat">${escapeHtml(categoryLabel(entry.category))}</span>
            <time datetime="${escapeHtml(entry.createdAt)}">${escapeHtml(formatDate(entry.createdAt))}</time>
          </div>
          ${entry.title ? `<h3 class="site-changelog-item-title">${escapeHtml(entry.title)}</h3>` : ""}
          ${entry.body ? `<p class="site-changelog-item-body">${escapeHtml(entry.body)}</p>` : ""}
          ${
            settings.includeFileList && entry.files?.length
              ? `<p class="muted site-changelog-files">${escapeHtml(entry.files.join(" · "))}</p>`
              : ""
          }
          ${
            settings.includeCommitHash && entry.commit
              ? `<p class="muted site-changelog-commit">${escapeHtml(entry.commit.slice(0, 12))}</p>`
              : ""
          }
        </li>`
        )
        .join("")}
    </ul>`;
}

export function initAdminChangelog({
  getActor,
  onStatus,
  isAdmin,
  isMember = () => true,
}) {
  const openBtn = document.getElementById("open-changelog-btn");
  const dialog = document.getElementById("changelog-dialog");
  const backdrop = document.getElementById("changelog-dialog-backdrop");
  const closeBtn = document.getElementById("changelog-close-btn");
  const saveSettingsBtn = document.getElementById("changelog-save-settings-btn");
  const addEntryBtn = document.getElementById("changelog-add-entry-btn");
  const entriesEl = document.getElementById("changelog-entries-admin");
  const feedEl = document.getElementById("site-changelog");
  const feedTitleEl = document.getElementById("site-changelog-title");
  const feedBodyEl = document.getElementById("site-changelog-body");
  const feedToggleBtn = document.getElementById("site-changelog-toggle");

  let db = normalizeChangelogDb({ settings: {}, entries: [] });
  let loading = false;

  function readSettingsFromForm() {
    const cats = {};
    for (const item of CHANGELOG_CATEGORIES) {
      const input = document.getElementById(`changelog-cat-${item.id}`);
      cats[item.id] = Boolean(input?.checked);
    }
    return {
      ...db.settings,
      enabled: document.getElementById("changelog-enabled")?.checked !== false,
      visibleTo: document.getElementById("changelog-visible-to")?.value || "all",
      maxVisible: Number(document.getElementById("changelog-max-visible")?.value || 6),
      title: document.getElementById("changelog-feed-title")?.value.trim() || "تحديثات الموقع",
      language: document.getElementById("changelog-language")?.value || "ar",
      tone: document.getElementById("changelog-tone")?.value || "brief",
      includeFileList: Boolean(document.getElementById("changelog-include-files")?.checked),
      includeCommitHash: Boolean(document.getElementById("changelog-include-commit")?.checked),
      autoPublish: document.getElementById("changelog-auto-publish")?.checked !== false,
      requireAdminApproval: Boolean(document.getElementById("changelog-require-approval")?.checked),
      template: document.getElementById("changelog-template")?.value || "{{title}}\n{{body}}",
      agentInstructions: document.getElementById("changelog-agent-instructions")?.value || "",
      includeCategories: cats,
    };
  }

  function fillSettingsForm() {
    const s = db.settings;
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(value);
    };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? "";
    };

    setChecked("changelog-enabled", s.enabled);
    setValue("changelog-visible-to", s.visibleTo);
    setValue("changelog-max-visible", String(s.maxVisible));
    setValue("changelog-feed-title", s.title);
    setValue("changelog-language", s.language);
    setValue("changelog-tone", s.tone);
    setChecked("changelog-include-files", s.includeFileList);
    setChecked("changelog-include-commit", s.includeCommitHash);
    setChecked("changelog-auto-publish", s.autoPublish);
    setChecked("changelog-require-approval", s.requireAdminApproval);
    setValue("changelog-template", s.template);
    setValue("changelog-agent-instructions", s.agentInstructions);

    for (const item of CHANGELOG_CATEGORIES) {
      setChecked(`changelog-cat-${item.id}`, s.includeCategories?.[item.id] !== false);
    }
  }

  function renderAdminEntries() {
    if (!entriesEl) return;
    if (!db.entries.length) {
      entriesEl.innerHTML = `<p class="muted">لا ملاحظات بعد. أضف ملاحظة يدوياً أو اترك Cursor يضيفها وفق سياسة الكتابة.</p>`;
      return;
    }

    entriesEl.innerHTML = db.entries
      .map((entry) => {
        const allowed = db.settings.includeCategories?.[entry.category] !== false;
        return `
        <article class="changelog-admin-entry ${entry.published ? "is-published" : "is-draft"} ${allowed ? "" : "is-filtered"}" data-id="${escapeHtml(entry.id)}">
          <div class="changelog-admin-entry-head">
            <span class="site-changelog-cat">${escapeHtml(categoryLabel(entry.category))}</span>
            <span class="muted">${escapeHtml(formatDate(entry.createdAt))}</span>
            <span class="changelog-admin-badges">
              ${entry.published ? '<span class="chip">منشور</span>' : '<span class="chip">مسودة</span>'}
              ${entry.source === "cursor" ? '<span class="chip">Cursor</span>' : '<span class="chip">يدوي</span>'}
              ${allowed ? "" : '<span class="chip">مخفي بالفئة</span>'}
            </span>
          </div>
          <label class="sr-only" for="changelog-title-${escapeHtml(entry.id)}">العنوان</label>
          <input id="changelog-title-${escapeHtml(entry.id)}" class="changelog-entry-title" type="text" value="${escapeHtml(entry.title)}" data-field="title" />
          <label class="sr-only" for="changelog-body-${escapeHtml(entry.id)}">النص</label>
          <textarea id="changelog-body-${escapeHtml(entry.id)}" class="changelog-entry-body" rows="3" data-field="body">${escapeHtml(entry.body)}</textarea>
          <div class="changelog-admin-entry-actions">
            <label class="changelog-inline-check">
              <input type="checkbox" data-field="published" ${entry.published ? "checked" : ""} />
              منشور
            </label>
            <label>
              الفئة
              <select data-field="category">
                ${CHANGELOG_CATEGORIES.map(
                  (item) =>
                    `<option value="${item.id}" ${item.id === entry.category ? "selected" : ""}>${escapeHtml(item.label)}</option>`
                ).join("")}
              </select>
            </label>
            <button type="button" class="btn ghost small" data-action="save-entry">حفظ</button>
            <button type="button" class="btn danger small" data-action="delete-entry">حذف</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderFeed() {
    if (!feedEl || !feedBodyEl) return;
    const visible = getVisibleEntries(db, {
      isAdmin: Boolean(isAdmin?.()),
      isMember: Boolean(isMember?.()),
    });

    if (!db.settings.enabled || !visible.length) {
      feedEl.classList.add("hidden");
      return;
    }

    feedEl.classList.remove("hidden");
    if (feedTitleEl) feedTitleEl.textContent = db.settings.title;
    feedBodyEl.innerHTML = renderPublicFeed(visible, db.settings);
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      db = await loadChangelogDb();
      fillSettingsForm();
      renderAdminEntries();
      renderFeed();
    } catch (error) {
      onStatus?.(error.message || "تعذّر تحميل سجل التحديثات", true);
    } finally {
      loading = false;
    }
  }

  async function persist(nextDb, message = "تم حفظ إعدادات التحديثات.") {
    db = await saveChangelogDb(nextDb);
    fillSettingsForm();
    renderAdminEntries();
    renderFeed();
    onStatus?.(message);
  }

  function openDialog() {
    if (!isAdmin?.()) {
      onStatus?.("لوحة التحديثات للمسؤولين فقط.", true);
      return;
    }
    dialog?.classList.remove("hidden");
    refresh();
  }

  function closeDialog() {
    dialog?.classList.add("hidden");
  }

  openBtn?.addEventListener("click", () => openDialog());
  closeBtn?.addEventListener("click", () => closeDialog());
  backdrop?.addEventListener("click", () => closeDialog());

  saveSettingsBtn?.addEventListener("click", async () => {
    if (!isAdmin?.()) return;
    saveSettingsBtn.disabled = true;
    try {
      const settings = readSettingsFromForm();
      await persist({ ...db, settings }, "تم حفظ سياسة ملاحظات التحديث.");
    } catch (error) {
      onStatus?.(error.message, true);
    } finally {
      saveSettingsBtn.disabled = false;
    }
  });

  addEntryBtn?.addEventListener("click", async () => {
    if (!isAdmin?.()) return;
    const titleInput = document.getElementById("changelog-new-title");
    const bodyInput = document.getElementById("changelog-new-body");
    const categoryInput = document.getElementById("changelog-new-category");
    const title = titleInput?.value.trim() || "";
    const body = bodyInput?.value.trim() || "";
    if (!title && !body) {
      onStatus?.("أدخل عنواناً أو نصاً للملاحظة.", true);
      return;
    }
    addEntryBtn.disabled = true;
    try {
      const actor = getActor?.();
      const entry = createChangelogEntry({
        title,
        body,
        category: categoryInput?.value || "other",
        author: actor?.username || "admin",
        source: "manual",
        published: db.settings.autoPublish && !db.settings.requireAdminApproval,
      });
      await persist({ ...db, entries: [entry, ...db.entries] }, "أُضيفت الملاحظة.");
      if (titleInput) titleInput.value = "";
      if (bodyInput) bodyInput.value = "";
    } catch (error) {
      onStatus?.(error.message, true);
    } finally {
      addEntryBtn.disabled = false;
    }
  });

  entriesEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !isAdmin?.()) return;
    const card = button.closest(".changelog-admin-entry");
    if (!card) return;
    const id = card.getAttribute("data-id");
    const entry = db.entries.find((item) => item.id === id);
    if (!entry) return;

    if (button.dataset.action === "delete-entry") {
      if (!window.confirm("حذف هذه الملاحظة؟")) return;
      button.disabled = true;
      try {
        await persist(
          { ...db, entries: db.entries.filter((item) => item.id !== id) },
          "حُذفت الملاحظة."
        );
      } catch (error) {
        onStatus?.(error.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (button.dataset.action === "save-entry") {
      const title = card.querySelector('[data-field="title"]')?.value.trim() || "";
      const body = card.querySelector('[data-field="body"]')?.value.trim() || "";
      const published = Boolean(card.querySelector('[data-field="published"]')?.checked);
      const category = card.querySelector('[data-field="category"]')?.value || entry.category;
      if (!title && !body) {
        onStatus?.("العنوان أو النص مطلوب.", true);
        return;
      }
      button.disabled = true;
      try {
        const nextEntries = db.entries.map((item) =>
          item.id === id
            ? {
                ...item,
                title,
                body,
                published,
                category,
                updatedAt: new Date().toISOString(),
              }
            : item
        );
        await persist({ ...db, entries: nextEntries }, "تم تحديث الملاحظة.");
      } catch (error) {
        onStatus?.(error.message, true);
      } finally {
        button.disabled = false;
      }
    }
  });

  feedToggleBtn?.addEventListener("click", () => {
    feedEl?.classList.toggle("is-collapsed");
    const collapsed = feedEl?.classList.contains("is-collapsed");
    if (feedToggleBtn) {
      feedToggleBtn.textContent = collapsed ? "إظهار" : "طيّ";
      feedToggleBtn.setAttribute("aria-expanded", String(!collapsed));
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!dialog || dialog.classList.contains("hidden")) return;
    closeDialog();
  });

  refresh();

  return {
    refresh,
    open: openDialog,
    close: closeDialog,
  };
}
