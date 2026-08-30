import {
  CHUNKING_ENGINES,
  CLASSIFICATION_ENGINES,
  DEFAULT_ENGINE_SETTINGS,
  SEARCH_ENGINES,
  normalizeEngineSettings,
} from "./registry.js";
import { engineNeedsModel } from "./search.js";
import { getSemanticModelStatus } from "./semantic-search.js";

function buildOptions(registry, selectedId) {
  return Object.values(registry)
    .map(
      (item) =>
        `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${item.label}</option>`
    )
    .join("");
}

function describeEngine(registry, id) {
  return registry[id]?.description || "";
}

export function renderSettingsForm(settings) {
  const normalized = normalizeEngineSettings(settings);
  return `
    <div class="settings-grid">
      <div class="settings-field">
        <label for="search-engine-select">محرك البحث</label>
        <select id="search-engine-select">${buildOptions(SEARCH_ENGINES, normalized.searchEngine)}</select>
        <p id="search-engine-desc" class="muted settings-desc">${describeEngine(SEARCH_ENGINES, normalized.searchEngine)}</p>
      </div>
      <div class="settings-field">
        <label for="classification-engine-select">محرك التصنيف</label>
        <select id="classification-engine-select">${buildOptions(CLASSIFICATION_ENGINES, normalized.classificationEngine)}</select>
        <p id="classification-engine-desc" class="muted settings-desc">${describeEngine(CLASSIFICATION_ENGINES, normalized.classificationEngine)}</p>
      </div>
      <div class="settings-field">
        <label for="chunking-engine-select">طريقة تقسيم النص</label>
        <select id="chunking-engine-select">${buildOptions(CHUNKING_ENGINES, normalized.chunkingEngine)}</select>
        <p id="chunking-engine-desc" class="muted settings-desc">${describeEngine(CHUNKING_ENGINES, normalized.chunkingEngine)}</p>
        <p class="muted settings-note">تغيير التقسيم يُطبَّق على الملفات الجديدة فقط.</p>
      </div>
    </div>
    <div id="settings-model-status" class="settings-model-status hidden"></div>
    <div class="settings-actions">
      <button id="settings-save-btn" class="btn primary" type="button">حفظ الإعدادات</button>
      <button id="settings-reset-btn" class="btn ghost" type="button">استعادة الافتراضي (BM25)</button>
    </div>
  `;
}

export function bindSettingsForm(root, { getSettings, onSave, onStatus }) {
  const searchSelect = root.querySelector("#search-engine-select");
  const classificationSelect = root.querySelector("#classification-engine-select");
  const chunkingSelect = root.querySelector("#chunking-engine-select");
  const searchDesc = root.querySelector("#search-engine-desc");
  const classificationDesc = root.querySelector("#classification-engine-desc");
  const chunkingDesc = root.querySelector("#chunking-engine-desc");
  const modelStatus = root.querySelector("#settings-model-status");
  const saveBtn = root.querySelector("#settings-save-btn");
  const resetBtn = root.querySelector("#settings-reset-btn");

  function updateDescriptions() {
    searchDesc.textContent = describeEngine(SEARCH_ENGINES, searchSelect.value);
    classificationDesc.textContent = describeEngine(
      CLASSIFICATION_ENGINES,
      classificationSelect.value
    );
    chunkingDesc.textContent = describeEngine(CHUNKING_ENGINES, chunkingSelect.value);

    const needsModel = engineNeedsModel(searchSelect.value);
    if (needsModel) {
      modelStatus.classList.remove("hidden");
      const status = getSemanticModelStatus();
      const statusText =
        status === "ready"
          ? "النموذج الدلالي جاهز."
          : status === "loading"
            ? "جارٍ تحميل النموذج…"
            : "سيُحمَّل النموذج عند أول بحث دلالي.";
      modelStatus.textContent = statusText;
    } else {
      modelStatus.classList.add("hidden");
    }
  }

  searchSelect?.addEventListener("change", updateDescriptions);
  classificationSelect?.addEventListener("change", updateDescriptions);
  chunkingSelect?.addEventListener("change", updateDescriptions);
  updateDescriptions();

  saveBtn?.addEventListener("click", async () => {
    const next = normalizeEngineSettings({
      searchEngine: searchSelect.value,
      classificationEngine: classificationSelect.value,
      chunkingEngine: chunkingSelect.value,
    });
    await onSave(next);
    onStatus?.("تم حفظ إعدادات البحث والفهرسة.", true);
    setTimeout(() => onStatus?.("", false), 2200);
  });

  resetBtn?.addEventListener("click", async () => {
    searchSelect.value = DEFAULT_ENGINE_SETTINGS.searchEngine;
    classificationSelect.value = DEFAULT_ENGINE_SETTINGS.classificationEngine;
    chunkingSelect.value = DEFAULT_ENGINE_SETTINGS.chunkingEngine;
    updateDescriptions();
    await onSave({ ...DEFAULT_ENGINE_SETTINGS });
    onStatus?.("تمت استعادة الإعدادات الافتراضية (BM25).", true);
    setTimeout(() => onStatus?.("", false), 2200);
  });

  const current = normalizeEngineSettings(getSettings());
  searchSelect.value = current.searchEngine;
  classificationSelect.value = current.classificationEngine;
  chunkingSelect.value = current.chunkingEngine;
  updateDescriptions();
}
