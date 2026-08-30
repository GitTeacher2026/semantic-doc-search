import {
  assignCategory,
} from "./bm25-search.js";
import { advancedSearch } from "./advanced-search.js";
import {
  applySearchOptionsToForm,
  loadSearchOptions,
  readSearchOptionsFromForm,
  saveSearchOptions,
} from "./search-options.js";
import {
  documentMatchesActiveStorage,
  getActiveStorageBackend,
  getDocumentStoragePath,
  getStorageBackendIcon,
  getStorageBackendLabel,
  inferDocumentStorage,
  STORAGE_BACKENDS,
} from "./document-storage.js";
import { initTheme, toggleTheme } from "./theme.js";
import { bindSearchResults, renderSearchResults } from "./search-results.js";
import { extractImageText, formatOcrProgress, isImageFile } from "./ocr.js?v=20260830";
import {
  ensurePreviewUrl,
  initImagePreview,
  openImagePreview,
  revokeAllPreviewUrls,
  syncPreviewUrls,
} from "./image-preview.js";
import {
  EXT_GROUPS,
  GROUP_ICONS,
  GROUP_LABELS,
  fileEndsWith,
  fileExtension,
  fileGroup,
  formatFileSize,
} from "./constants.js";
import {
  accessibleDocuments,
  clearUnlockSession,
  hashPassword,
  isDocUnlocked,
  lockDocSession,
  unlockDoc,
  verifyLockPassword,
} from "./file-lock.js";
import {
  clearStorageSession,
  isCloudSyncEnabled,
  isUsingDriveStorage,
  isUsingGitHubStorage,
  loadDocuments,
  saveDocuments,
} from "./storage.js";
import {
  getResolvedStorageMode,
  getStorageModeLabel,
  hasStorageChoice,
  isDriveModeAvailable,
  isGitHubModeAvailable,
  setStorageMode,
  STORAGE_MODES,
} from "./storage-preference.js";
import {
  clearDriveSession,
  isDriveConnected,
  isDriveConfigured,
  loginToGoogleDrive,
  logoutGoogleDrive,
} from "./drive-auth.js";
import { uploadDocumentFile, downloadDriveFile } from "./drive-storage.js";
import {
  approvePendingUser,
  rejectPendingUser,
  resendPendingSignupEmails,
} from "./auth-service.js";
import { initAdminMembers } from "./admin-members.js";
import { getVaultPassword } from "./auth-page.js";
import {
  daysUntilPurge,
  moveToTrash,
  normalizeState,
  permanentlyDelete,
  restoreFromTrash,
  TRASH_RETENTION_DAYS,
} from "./trash.js";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

let explorerShowAll = false;
let pendingFiles = [];
let state = normalizeState({});
let sessionPassword = "";
let isHydrating = false;
let pendingDeleteId = null;
let pendingLockId = null;
let pendingUnlockId = null;
let pendingUnlockAction = null;
let authApi = null;
let currentUser = null;
let adminMembersApi = null;

const appView = document.getElementById("app-view");
const logoutBtn = document.getElementById("logout-btn");
const userGreeting = document.getElementById("user-greeting");
const adminToolbar = document.getElementById("admin-toolbar");
const openPendingBtn = document.getElementById("open-pending-btn");
const pendingCountBadge = document.getElementById("pending-count-badge");
const pendingDialog = document.getElementById("pending-dialog");
const pendingDialogBackdrop = document.getElementById("pending-dialog-backdrop");
const pendingCloseBtn = document.getElementById("pending-close-btn");
const pendingUsersList = document.getElementById("pending-users-list");
const resendEmailBtn = document.getElementById("resend-email-btn");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const driveConnectPanel = document.getElementById("drive-connect-panel");
const driveStatusText = document.getElementById("drive-status-text");
const driveLoginBtn = document.getElementById("drive-login-btn");
const driveLogoutBtn = document.getElementById("drive-logout-btn");
const storageSettingsPanel = document.getElementById("storage-settings-panel");
const storageModePicker = document.getElementById("storage-mode-picker");
const storageModeStatus = document.getElementById("storage-mode-status");
const storageModeInputs = () =>
  Array.from(document.querySelectorAll('input[name="storage-mode"]'));
const pendingFilesEl = document.getElementById("pending-files");
const ingestBtn = document.getElementById("ingest-btn");
const libraryList = document.getElementById("library-list");
const explorerStorageLabel = document.getElementById("explorer-storage-label");
const explorerToggleAllBtn = document.getElementById("explorer-toggle-all-btn");
const advancedSearchPanel = document.getElementById("advanced-search-panel");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const trashMeta = document.getElementById("trash-meta");
const trashList = document.getElementById("trash-list");
const libraryPage = document.getElementById("library-page");
const trashPage = document.getElementById("trash-page");
const navLibraryBtn = document.getElementById("nav-library-btn");
const navTrashBtn = document.getElementById("nav-trash-btn");
const trashBackBtn = document.getElementById("trash-back-btn");
const trashCountBadge = document.getElementById("trash-count-badge");
const categoryFilter = document.getElementById("category-filter");
const searchQuery = document.getElementById("search-query");
const searchBtn = document.getElementById("search-btn");
const clearSearchBtn = document.getElementById("clear-search-btn");
const searchResults = document.getElementById("search-results");
const resultCount = document.getElementById("result-count");
const resultCountLabel = document.getElementById("result-count-label");
const statusBanner = document.getElementById("status-banner");

const deleteDialog = document.getElementById("delete-dialog");
const deleteDialogTitle = document.getElementById("delete-dialog-title");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteDialogBackdrop = document.getElementById("delete-dialog-backdrop");

const lockDialog = document.getElementById("lock-dialog");
const lockDialogTitle = document.getElementById("lock-dialog-title");
const lockDialogSub = document.getElementById("lock-dialog-sub");
const lockPassword = document.getElementById("lock-password");
const lockPasswordConfirm = document.getElementById("lock-password-confirm");
const lockDialogError = document.getElementById("lock-dialog-error");
const lockConfirmBtn = document.getElementById("lock-confirm-btn");
const lockCancelBtn = document.getElementById("lock-cancel-btn");
const lockDialogBackdrop = document.getElementById("lock-dialog-backdrop");

const unlockDialog = document.getElementById("unlock-dialog");
const unlockDialogTitle = document.getElementById("unlock-dialog-title");
const unlockDialogSub = document.getElementById("unlock-dialog-sub");
const unlockPassword = document.getElementById("unlock-password");
const unlockDialogError = document.getElementById("unlock-dialog-error");
const unlockConfirmBtn = document.getElementById("unlock-confirm-btn");
const unlockCancelBtn = document.getElementById("unlock-cancel-btn");
const unlockDialogBackdrop = document.getElementById("unlock-dialog-backdrop");

async function hydrateDocuments(password) {
  isHydrating = true;
  setStatus("جارٍ تحميل المستندات…");
  try {
    state = normalizeState(await loadDocuments(password));
    renderLibrary();
    renderTrash();
    updateStoragePanel();
    updateUploadAccess();
    setStatus("", false);
  } catch (error) {
    setStatus(`تعذّر تحميل المستندات: ${error.message}`, true);
    throw error;
  } finally {
    isHydrating = false;
  }
}

async function persistState() {
  if (!sessionPassword) return;
  state = normalizeState(state);
  await saveDocuments(sessionPassword, state);
}

function isAuthed() {
  return Boolean(currentUser);
}

function canUploadFiles() {
  if (!isCloudSyncEnabled()) return true;
  if (isUsingDriveStorage()) return isDriveConnected();
  if (isUsingGitHubStorage()) return true;
  return true;
}

function syncStorageModeInputs() {
  const mode = getResolvedStorageMode();
  for (const input of storageModeInputs()) {
    input.checked = input.value === mode;
  }
}

function updateStoragePanel() {
  const driveAvailable = isDriveModeAvailable();
  const githubAvailable = isGitHubModeAvailable();
  const showSettings = driveAvailable || githubAvailable;

  storageSettingsPanel?.classList.toggle("hidden", !showSettings);
  storageModePicker?.classList.toggle("hidden", !hasStorageChoice());
  syncStorageModeInputs();

  const mode = getResolvedStorageMode();
  if (storageModeStatus) {
    if (mode === STORAGE_MODES.GITHUB && githubAvailable) {
      storageModeStatus.textContent =
        "التخزين عبر GitHub — تُحفظ الملفات والفهرس في المستودع المشفّر.";
    } else if (mode === STORAGE_MODES.DRIVE && driveAvailable) {
      storageModeStatus.textContent =
        "التخزين عبر Google Drive — تُرفع الملفات إلى مجلدات حسب التصنيف.";
    } else {
      storageModeStatus.textContent = "";
    }
  }

  updateDrivePanel();
}

function updateDrivePanel() {
  if (!driveConnectPanel) return;
  const showDrivePanel = isUsingDriveStorage() && isDriveModeAvailable();
  driveConnectPanel.classList.toggle("hidden", !showDrivePanel);
  if (!showDrivePanel) return;

  const connected = isDriveConnected();
  if (driveStatusText) {
    driveStatusText.textContent = connected
      ? "متصل — يمكنك رفع الملفات وحفظها في Google Drive."
      : "غير متصل — سجّل الدخول إلى Google Drive قبل رفع أي ملف.";
  }
  driveLoginBtn?.classList.toggle("hidden", connected);
  driveLogoutBtn?.classList.toggle("hidden", !connected);
}

async function handleStorageModeChange(nextMode) {
  const currentMode = getResolvedStorageMode();
  if (nextMode === currentMode) return;

  const confirmed = window.confirm(
    `سيتم التبديل إلى ${getStorageModeLabel(nextMode)}.\n` +
      "سيتم تحميل المستندات من مصدر التخزين الجديد. هل تريد المتابعة؟"
  );
  if (!confirmed) {
    syncStorageModeInputs();
    return;
  }

  setStorageMode(nextMode);
  explorerShowAll = false;
  revokeAllPreviewUrls();
  pendingFiles = [];
  renderPendingFiles();
  clearStorageSession();
  updateStoragePanel();
  updateUploadAccess();

  if (!sessionPassword) return;
  try {
    await hydrateDocuments(sessionPassword);
    setStatus(`تم التبديل إلى ${getStorageModeLabel(nextMode)}.`, true);
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    setStatus(`تعذّر تحميل المستندات: ${error.message}`, true);
  }
}

function updateUploadAccess() {
  const allowed = canUploadFiles();
  dropZone?.classList.toggle("is-disabled", !allowed);
  if (fileInput) fileInput.disabled = !allowed;
  ingestBtn.disabled = !allowed || !pendingFiles.length;
}

async function handleDriveLogin() {
  if (!driveLoginBtn) return;
  driveLoginBtn.disabled = true;
  setStatus("جارٍ ربط Google Drive…");
  try {
    await loginToGoogleDrive();
    await hydrateDocuments(sessionPassword);
    updateStoragePanel();
    updateUploadAccess();
    setStatus("تم ربط Google Drive بنجاح.", true);
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    driveLoginBtn.disabled = false;
  }
}

function handleDriveLogout() {
  logoutGoogleDrive();
  revokeAllPreviewUrls();
  pendingFiles = [];
  renderPendingFiles();
  updateStoragePanel();
  updateUploadAccess();
  setStatus("تم قطع اتصال Google Drive. لن يمكن رفع ملفات جديدة حتى تسجيل الدخول مجدداً.", true);
  setTimeout(() => setStatus("", false), 3000);
}

function showView() {
  if (!isAuthed()) return;
  appView.classList.remove("hidden");
  if (userGreeting && currentUser) {
    userGreeting.textContent = `مرحباً ${currentUser.firstName} ${currentUser.lastName} (@${currentUser.username})`;
  }
  if (!isHydrating && sessionPassword) {
    renderLibrary();
    renderTrash();
    refreshAdminToolbar();
    updateStoragePanel();
    updateUploadAccess();
    switchAppPage("library");
  }
}

function updatePendingBadge(count) {
  if (!pendingCountBadge) return;
  if (count > 0) {
    pendingCountBadge.textContent = String(count);
    pendingCountBadge.classList.remove("hidden");
  } else {
    pendingCountBadge.classList.add("hidden");
  }
}

async function refreshAdminToolbar() {
  if (!adminToolbar) return;
  if (!authApi?.isAdmin?.()) {
    adminToolbar.classList.add("hidden");
    return;
  }

  adminToolbar.classList.remove("hidden");
  try {
    const pending = await authApi.listPendingUsers();
    updatePendingBadge(pending.length);
  } catch {
    updatePendingBadge(0);
  }
}

function openPendingDialog() {
  pendingDialog?.classList.remove("hidden");
  renderPendingUsers();
}

function closePendingDialog() {
  pendingDialog?.classList.add("hidden");
}

function setStatus(message, show = true) {
  if (!show) {
    statusBanner.classList.add("hidden");
    return;
  }
  statusBanner.textContent = message;
  statusBanner.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function largeIconMarkup(group) {
  const icon = GROUP_ICONS[group] || GROUP_ICONS.other;
  return `<div class="file-icon-large ${group}" aria-hidden="true">${icon}</div>`;
}

function setPendingFiles(files) {
  syncPreviewUrls(files, isImageFile);
  pendingFiles = [...files];
  renderPendingFiles();
  updateUploadAccess();
}

function renderPendingFileCard(file, index) {
  const image = isImageFile(file.name);
  const previewUrl = image ? ensurePreviewUrl(file) : "";
  const visual = image
    ? `<button type="button" class="pending-file-thumb" data-preview-index="${index}" aria-label="معاينة ${escapeHtml(file.name)}">
        <img src="${previewUrl}" alt="" loading="lazy" />
      </button>`
    : largeIconMarkup(fileGroup(file.name));

  return `
    <article class="pending-file-card${image ? " is-image" : ""}">
      ${visual}
      <div class="pending-file-name">${escapeHtml(file.name)}</div>
      <div class="pending-file-size">${formatFileSize(file.size)}${image ? " · OCR" : ""}</div>
      <button class="pending-file-remove" type="button" data-index="${index}">إزالة</button>
    </article>`;
}

function renderPendingFiles() {
  if (!pendingFiles.length) {
    pendingFilesEl.classList.add("hidden");
    pendingFilesEl.innerHTML = "";
    return;
  }

  pendingFilesEl.classList.remove("hidden");
  pendingFilesEl.innerHTML = pendingFiles
    .map((file, index) => renderPendingFileCard(file, index))
    .join("");

  pendingFilesEl.querySelectorAll(".pending-file-thumb").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.previewIndex);
      const file = pendingFiles[index];
      if (!file) return;
      const url = ensurePreviewUrl(file);
      if (url) openImagePreview(url, file.name);
    });
  });

  pendingFilesEl.querySelectorAll(".pending-file-remove").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.index);
      setPendingFiles(pendingFiles.filter((_, i) => i !== index));
    });
  });
}

function setupDropZone() {
  const addFiles = (fileList) => {
    if (!fileList?.length) return;
    if (!canUploadFiles()) {
      setStatus("يرجى تسجيل الدخول إلى Google Drive قبل رفع الملفات.", true);
      return;
    }
    const merged = [...pendingFiles];
    for (const file of fileList) merged.push(file);
    setPendingFiles(merged);
  };

  dropZone.addEventListener("click", (event) => {
    if (!canUploadFiles()) {
      event.preventDefault();
      setStatus("يرجى تسجيل الدخول إلى Google Drive قبل رفع الملفات.", true);
    }
  });

  dropZone.addEventListener("keydown", (event) => {
    if (!canUploadFiles()) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (!canUploadFiles()) return;
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    if (!canUploadFiles()) {
      event.preventDefault();
      setStatus("يرجى تسجيل الدخول إلى Google Drive قبل رفع الملفات.", true);
      return;
    }
    addFiles([...event.dataTransfer.files]);
  });
}

async function loadJsZip() {
  const mod = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  return mod.default || mod;
}

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.length ? chunks : [text || ""];
}

function extractDocxXmlText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const texts = [];
  const wordNodes = doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "t"
  );
  for (const node of wordNodes) {
    if (node.textContent) texts.push(node.textContent);
  }
  if (!texts.length) {
    for (const node of doc.getElementsByTagName("*")) {
      if (node.localName === "t" && node.textContent) texts.push(node.textContent);
    }
  }
  return texts.join(" ").replace(/\s+/g, " ").trim();
}

async function extractDocxText(arrayBuffer) {
  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = zip.file("word/document.xml");
  if (!documentXml) throw new Error("ملف Word غير صالح (document.xml مفقود).");
  const text = extractDocxXmlText(await documentXml.async("string"));
  if (!text) throw new Error("لم يُعثر على نص داخل ملف Word.");
  return text;
}

async function extractExcelText(arrayBuffer) {
  const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    parts.push(`## ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
    });
    for (const row of rows) {
      const cells = row.map((cell) => String(cell).trim()).filter(Boolean);
      if (cells.length) parts.push(cells.join(" | "));
    }
  }
  return parts.join("\n").trim();
}

async function extractPptxText(arrayBuffer) {
  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts = [];
  for (const [index, slidePath] of slidePaths.entries()) {
    const xml = await zip.files[slidePath].async("text");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const texts = [...doc.getElementsByTagName("a:t")]
      .map((node) => node.textContent.trim())
      .filter(Boolean);
    if (texts.length) {
      parts.push(`## شريحة ${index + 1}`);
      parts.push(texts.join(" "));
    }
  }
  return parts.join("\n").trim();
}

async function extractPdfText(arrayBuffer) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str).join(" "));
  }
  return parts.join("\n").trim();
}

async function extractText(file, arrayBuffer, { onOcrProgress } = {}) {
  const name = String(file?.name || "");
  const buffer = arrayBuffer || (await file.arrayBuffer());
  if (isImageFile(name)) {
    return extractImageText(new Blob([buffer], { type: file.type || "image/jpeg" }), onOcrProgress);
  }
  if (fileEndsWith(name, ".pdf")) return extractPdfText(buffer);
  if (fileEndsWith(name, ".docx")) return extractDocxText(buffer);
  if (fileEndsWith(name, ".xlsx") || fileEndsWith(name, ".xls")) return extractExcelText(buffer);
  if (fileEndsWith(name, ".pptx")) return extractPptxText(buffer);
  if (fileEndsWith(name, ".doc") || fileEndsWith(name, ".ppt")) {
    throw new Error(`${name}: صيغ .doc و .ppt القديمة غير مدعومة في المتصفح. استخدم docx/pptx.`);
  }
  if (EXT_GROUPS.text.some((ext) => fileEndsWith(name, ext))) {
    return new TextDecoder("utf-8").decode(buffer).trim();
  }
  throw new Error(`نوع الملف غير مدعوم: ${name}`);
}

async function renderPendingUsers() {
  if (!pendingUsersList || !authApi?.isAdmin?.()) return;

  pendingUsersList.innerHTML = `<p class="muted">جارٍ تحميل الطلبات…</p>`;

  try {
    const pending = await authApi.listPendingUsers();
    updatePendingBadge(pending.length);

    if (!pending.length) {
      pendingUsersList.innerHTML = `<p class="muted">لا توجد طلبات تسجيل معلّقة.</p>`;
      return;
    }

    pendingUsersList.innerHTML = pending
      .map(
        (user) => `
        <div class="pending-user-row" data-id="${user.id}">
          <div>
            <strong>${escapeHtml(user.firstName)} ${escapeHtml(user.lastName)}</strong>
            <div class="muted">@${escapeHtml(user.username)} · ${escapeHtml(user.email)}</div>
          </div>
          <div class="pending-user-actions">
            <button class="btn primary small approve-user-btn" data-id="${user.id}" type="button">موافقة</button>
            <button class="btn ghost small reject-user-btn" data-id="${user.id}" type="button">رفض</button>
          </div>
        </div>`
      )
      .join("");

    pendingUsersList.querySelectorAll(".approve-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await approvePendingUser(btn.dataset.id);
          setStatus("تمت الموافقة وإرسال بريد تأكيدي للمستخدم.", true);
          await renderPendingUsers();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });

    pendingUsersList.querySelectorAll(".reject-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("رفض هذا الطلب؟")) return;
        try {
          await rejectPendingUser(btn.dataset.id);
          setStatus("تم رفض الطلب وإبلاغ المستخدم.", true);
          await renderPendingUsers();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });
  } catch (error) {
    pendingUsersList.innerHTML = `<p class="auth-error">${escapeHtml(error.message)}</p>`;
  }
}

if (resendEmailBtn) {
  resendEmailBtn.addEventListener("click", async () => {
    try {
      setStatus("جارٍ إرسال بريد الموافقة من المتصفح…");
      const result = await resendPendingSignupEmails();
      setStatus(result.message, true);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

openPendingBtn?.addEventListener("click", openPendingDialog);
pendingCloseBtn?.addEventListener("click", closePendingDialog);
pendingDialogBackdrop?.addEventListener("click", closePendingDialog);

function buildExplorerTree(documents, { showAll = false } = {}) {
  const visibleDocs = documents.filter((doc) => documentMatchesActiveStorage(doc, { showAll }));
  const storageGroups = new Map();

  for (const doc of visibleDocs) {
    const storage = inferDocumentStorage(doc);
    const category = doc.category || "عام";
    const group = doc.fileGroup || fileGroup(doc.filename);

    if (!storageGroups.has(storage)) storageGroups.set(storage, new Map());
    const categories = storageGroups.get(storage);
    if (!categories.has(category)) categories.set(category, new Map());
    const groups = categories.get(category);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(doc);
  }

  const storageOrder = [getActiveStorageBackend(), STORAGE_BACKENDS.GITHUB, STORAGE_BACKENDS.DRIVE, STORAGE_BACKENDS.LOCAL];
  const orderedStorages = [...storageGroups.keys()].sort(
    (a, b) => storageOrder.indexOf(a) - storageOrder.indexOf(b) || a.localeCompare(b, "ar")
  );

  return orderedStorages.map((storage) => ({
    storage,
    label: getStorageBackendLabel(storage),
    icon: getStorageBackendIcon(storage),
    count: [...storageGroups.get(storage).values()].reduce(
      (sum, groups) => sum + [...groups.values()].reduce((inner, files) => inner + files.length, 0),
      0
    ),
    categories: [...storageGroups.get(storage).entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ar"))
      .map(([category, groups]) => ({
        category,
        count: [...groups.values()].reduce((sum, files) => sum + files.length, 0),
        groups: [...groups.entries()]
          .sort((a, b) => GROUP_LABELS[a[0]].localeCompare(GROUP_LABELS[b[0]], "ar"))
          .map(([group, files]) => ({
            group,
            label: GROUP_LABELS[group] || group,
            icon: GROUP_ICONS[group] || GROUP_ICONS.other,
            files: [...files].sort((a, b) => a.filename.localeCompare(b.filename, "ar")),
          })),
      })),
  }));
}

function updateExplorerToolbar(docs) {
  const active = getActiveStorageBackend();
  const activeLabel = getStorageBackendLabel(active);
  const otherCount = docs.filter((doc) => !documentMatchesActiveStorage(doc)).length;

  if (explorerStorageLabel) {
    explorerStorageLabel.textContent = explorerShowAll
      ? "عرض جميع الملفات من كل مصادر التخزين"
      : `عرض ملفات ${activeLabel} فقط`;
  }

  if (explorerToggleAllBtn) {
    explorerToggleAllBtn.textContent = explorerShowAll ? `عرض ${activeLabel} فقط` : "عرض كل المصادر";
    explorerToggleAllBtn.classList.toggle("hidden", otherCount === 0 && !explorerShowAll);
  }
}

function switchAppPage(page) {
  const isTrash = page === "trash";
  libraryPage?.classList.toggle("hidden", isTrash);
  trashPage?.classList.toggle("hidden", !isTrash);
  navLibraryBtn?.classList.toggle("active", !isTrash);
  navTrashBtn?.classList.toggle("active", isTrash);
  if (isTrash) renderTrash();
}

function updateTrashBadge() {
  const count = (state.trash || []).length;
  if (!trashCountBadge) return;
  if (count > 0) {
    trashCountBadge.textContent = String(count);
    trashCountBadge.classList.remove("hidden");
  } else {
    trashCountBadge.classList.add("hidden");
  }
}

navLibraryBtn?.addEventListener("click", () => switchAppPage("library"));
navTrashBtn?.addEventListener("click", () => switchAppPage("trash"));
trashBackBtn?.addEventListener("click", () => switchAppPage("library"));

function summarizeCategories(documents) {
  const counts = new Map();
  for (const doc of documents) counts.set(doc.category, (counts.get(doc.category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"));
}

function renderDocActions(doc) {
  const locked = doc.isLocked;
  const unlocked = isDocUnlocked(doc);
  const lockBtn = locked
    ? `<button class="btn ghost small unlock-btn" data-id="${doc.id}" type="button">${unlocked ? "إعادة القفل" : "فتح"}</button>`
    : `<button class="btn ghost small lock-btn" data-id="${doc.id}" type="button">قفل</button>`;
  return `
    <button class="btn ghost small download-btn" data-id="${doc.id}" type="button">تنزيل</button>
    ${lockBtn}
    <button class="btn ghost small delete-btn" data-id="${doc.id}" type="button">حذف</button>`;
}

function renderTreeFile(doc) {
  const groupName = doc.fileGroup || fileGroup(doc.filename);
  const lockedClass = doc.isLocked ? " locked" : "";
  const lockBadge = doc.isLocked ? `<span class="lock-badge">🔒</span>` : "";
  const storage = inferDocumentStorage(doc);
  const storageClass = `storage-${storage}`;
  return `
    <li class="tree-file${lockedClass}" role="treeitem" data-id="${doc.id}">
      <div class="tree-file-row">
        <span class="tree-file-icon" aria-hidden="true">${GROUP_ICONS[groupName] || GROUP_ICONS.other}</span>
        <div class="tree-file-info">
          <span class="tree-file-name">${lockBadge}${escapeHtml(doc.filename)}</span>
          <span class="tree-file-meta">
            <span class="storage-badge ${storageClass}">${getStorageBackendIcon(storage)} ${escapeHtml(getStorageBackendLabel(storage))}</span>
            <span class="tree-file-path">${escapeHtml(getDocumentStoragePath(doc))}</span>
            <span class="tree-file-size">${doc.charCount.toLocaleString("ar-EG")} حرف</span>
          </span>
        </div>
        <div class="tree-file-actions explorer-actions">
          ${renderDocActions(doc)}
        </div>
      </div>
    </li>`;
}

function renderLibrary() {
  const docs = state.documents;
  const categories = summarizeCategories(docs);

  categoryFilter.innerHTML = `<option value="">جميع التصنيفات</option>${categories
    .map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("")}`;

  updateExplorerToolbar(docs);

  if (!docs.length) {
    libraryList.innerHTML = `<p class="muted tree-empty">لا توجد مستندات بعد. اسحب ملفاً إلى منطقة الرفع للبدء.</p>`;
    return;
  }

  const tree = buildExplorerTree(docs, { showAll: explorerShowAll });
  const visibleCount = tree.reduce((sum, storageNode) => sum + storageNode.count, 0);

  if (!visibleCount) {
    libraryList.innerHTML = `<p class="muted tree-empty">لا توجد ملفات في ${escapeHtml(getStorageBackendLabel(getActiveStorageBackend()))}. جرّب «عرض كل المصادر» أو غيّر مكان التخزين.</p>`;
    return;
  }

  libraryList.innerHTML = tree
    .map(
      (storageNode) => `
      <details class="tree-storage-root" open>
        <summary class="tree-storage-label">
          <span class="tree-chevron" aria-hidden="true"></span>
          <span class="tree-storage-icon" aria-hidden="true">${storageNode.icon}</span>
          <span class="tree-storage-name">${escapeHtml(storageNode.label)}</span>
          <span class="tree-folder-count">${storageNode.count}</span>
        </summary>
        <div class="tree-storage-children">
          ${storageNode.categories
            .map(
              (folder) => `
            <details class="tree-folder" open>
              <summary class="tree-folder-label">
                <span class="tree-chevron" aria-hidden="true"></span>
                <span class="tree-folder-icon" aria-hidden="true">📁</span>
                <span class="tree-folder-name">${escapeHtml(folder.category)}</span>
                <span class="tree-folder-count">${folder.count}</span>
              </summary>
              <div class="tree-children">
                ${folder.groups
                  .map(
                    (group) => `
                  <details class="tree-folder tree-folder-nested" open>
                    <summary class="tree-folder-label">
                      <span class="tree-chevron" aria-hidden="true"></span>
                      <span class="tree-folder-icon" aria-hidden="true">${group.icon}</span>
                      <span class="tree-folder-name">${escapeHtml(group.label)}</span>
                      <span class="tree-folder-count">${group.files.length}</span>
                    </summary>
                    <ul class="tree-files" role="group">
                      ${group.files.map((doc) => renderTreeFile(doc)).join("")}
                    </ul>
                  </details>`
                  )
                  .join("")}
              </div>
            </details>`
            )
            .join("")}
        </div>
      </details>`
    )
    .join("");

  bindLibraryActions();
}

function bindLibraryActions() {
  libraryList.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDeleteDialog(btn.dataset.id));
  });

  libraryList.querySelectorAll(".download-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDownload(btn.dataset.id));
  });

  libraryList.querySelectorAll(".lock-btn").forEach((btn) => {
    btn.addEventListener("click", () => openLockDialog(btn.dataset.id));
  });

  libraryList.querySelectorAll(".unlock-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleUnlockButton(btn.dataset.id));
  });
}

function renderTrash() {
  const trash = state.trash || [];
  updateTrashBadge();
  trashMeta.textContent =
    trash.length === 0
      ? `سلة المهملات فارغة. الملفات المحذوفة تُحذف نهائياً بعد ${TRASH_RETENTION_DAYS} يوماً.`
      : `${trash.length} ملف في السلة — يُحذف تلقائياً بعد ${TRASH_RETENTION_DAYS} يوماً.`;

  if (!trash.length) {
    trashList.innerHTML = `<p class="muted">لا توجد ملفات في سلة المهملات.</p>`;
    return;
  }

  trashList.innerHTML = trash
    .map((doc) => {
      const daysLeft = daysUntilPurge(doc.deletedAt);
      const groupName = doc.fileGroup || fileGroup(doc.filename);
      return `
      <article class="trash-item" data-id="${doc.id}">
        <div class="trash-item-info">
          <div class="trash-item-title">${GROUP_ICONS[groupName] || "📁"} ${escapeHtml(doc.filename)}</div>
          <div class="trash-item-meta">يُحذف نهائياً خلال ${daysLeft} يوم · ${escapeHtml(doc.category || "")}</div>
        </div>
        <div class="trash-actions">
          <button class="btn ghost small restore-btn" data-id="${doc.id}" type="button">استعادة</button>
          <button class="btn ghost small purge-btn" data-id="${doc.id}" type="button">حذف نهائي</button>
        </div>
      </article>`;
    })
    .join("");

  trashList.querySelectorAll(".restore-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state = restoreFromTrash(state, btn.dataset.id);
      try {
        setStatus("جارٍ استعادة الملف…");
        await persistState();
        renderLibrary();
        renderTrash();
        setStatus("تمت استعادة الملف.", true);
        setTimeout(() => setStatus("", false), 2000);
      } catch (error) {
        setStatus(`تعذّرت الاستعادة: ${error.message}`, true);
      }
    });
  });

  trashList.querySelectorAll(".purge-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const doc = state.trash.find((item) => item.id === btn.dataset.id);
      if (!doc) return;
      if (!window.confirm(`حذف «${doc.filename}» نهائياً؟ لا يمكن التراجع.`)) return;
      state = permanentlyDelete(state, btn.dataset.id);
      try {
        setStatus("جارٍ الحذف النهائي…");
        await persistState();
        renderTrash();
        setStatus("تم الحذف النهائي.", true);
        setTimeout(() => setStatus("", false), 2000);
      } catch (error) {
        setStatus(`تعذّر الحذف: ${error.message}`, true);
      }
    });
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function findDocumentById(id) {
  return state.documents.find((doc) => doc.id === id);
}

async function downloadDocument(doc) {
  try {
    let bytes;
    if (doc.fileData) {
      bytes = Uint8Array.from(atob(doc.fileData), (char) => char.charCodeAt(0));
    } else if (doc.driveFileId) {
      if (!isDriveConnected()) {
        setStatus("هذا الملف مخزّن في Google Drive. سجّل الدخول إلى Drive لتنزيله.", true);
        return;
      }
      setStatus("جارٍ تنزيل الملف من Google Drive…");
      const buffer = await downloadDriveFile(doc.driveFileId);
      bytes = new Uint8Array(buffer);
      setStatus("", false);
    } else {
      setStatus("تعذّر التنزيل: الملف غير مخزّن. أعد رفع الملف.", true);
      return;
    }
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = doc.filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function handleDownload(docId) {
  const doc = findDocumentById(docId);
  if (!doc) return;
  if (doc.isLocked && !isDocUnlocked(doc)) {
    openUnlockDialog(docId, "download");
    return;
  }
  downloadDocument(doc);
}

function handleUnlockButton(docId) {
  const doc = findDocumentById(docId);
  if (!doc) return;
  if (doc.isLocked && isDocUnlocked(doc)) {
    lockDocSession(docId);
    renderLibrary();
    return;
  }
  openUnlockDialog(docId, "unlock");
}

function openDeleteDialog(docId) {
  const doc = findDocumentById(docId);
  if (!doc || !deleteDialog) return;
  pendingDeleteId = docId;
  deleteDialogTitle.textContent = `هل تريد نقل «${doc.filename}» إلى سلة المهملات؟`;
  deleteDialog.classList.remove("hidden");
}

function closeDeleteDialog() {
  pendingDeleteId = null;
  if (deleteDialog) deleteDialog.classList.add("hidden");
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const docId = pendingDeleteId;
  closeDeleteDialog();
  state = moveToTrash(state, docId);
  lockDocSession(docId);
  try {
    setStatus("جارٍ نقل الملف إلى سلة المهملات…");
    await persistState();
    renderLibrary();
    renderTrash();
    setStatus("تم نقل الملف إلى سلة المهملات.", true);
    setTimeout(() => setStatus("", false), 2000);
  } catch (error) {
    setStatus(`تعذّر الحذف: ${error.message}`, true);
  }
}

function openLockDialog(docId) {
  const doc = findDocumentById(docId);
  if (!doc || !lockDialog) return;
  pendingLockId = docId;
  lockDialogTitle.textContent = `قفل «${doc.filename}»`;
  lockDialogSub.textContent = "أدخل كلمة مرور لحماية هذا الملف. لن يظهر محتواه في البحث حتى تفتحه.";
  lockPassword.value = "";
  lockPasswordConfirm.value = "";
  lockDialogError.classList.add("hidden");
  lockDialog.classList.remove("hidden");
  lockPassword.focus();
}

function closeLockDialog() {
  pendingLockId = null;
  if (lockDialog) lockDialog.classList.add("hidden");
}

async function confirmLock() {
  if (!pendingLockId) return;
  const password = lockPassword.value;
  const confirm = lockPasswordConfirm.value;
  if (password.length < 4) {
    lockDialogError.textContent = "كلمة المرور يجب أن تكون 4 أحرف على الأقل.";
    lockDialogError.classList.remove("hidden");
    return;
  }
  if (password !== confirm) {
    lockDialogError.textContent = "كلمتا المرور غير متطابقتين.";
    lockDialogError.classList.remove("hidden");
    return;
  }

  const doc = findDocumentById(pendingLockId);
  if (!doc) return closeLockDialog();

  doc.isLocked = true;
  doc.lockHash = await hashPassword(password);
  lockDocSession(doc.id);
  closeLockDialog();

  try {
    await persistState();
    renderLibrary();
    setStatus("تم قفل الملف.", true);
    setTimeout(() => setStatus("", false), 2000);
  } catch (error) {
    setStatus(`تعذّر قفل الملف: ${error.message}`, true);
  }
}

function openUnlockDialog(docId, action = "unlock") {
  const doc = findDocumentById(docId);
  if (!doc || !unlockDialog) return;
  pendingUnlockId = docId;
  pendingUnlockAction = action;
  unlockDialogTitle.textContent = `فتح «${doc.filename}»`;
  unlockDialogSub.textContent =
    action === "download"
      ? "هذا الملف مقفل. أدخل كلمة مرور القفل للتنزيل."
      : "أدخل كلمة مرور القفل لعرض المحتوى والبحث فيه.";
  unlockPassword.value = "";
  unlockDialogError.classList.add("hidden");
  unlockDialog.classList.remove("hidden");
  unlockPassword.focus();
}

function closeUnlockDialog() {
  pendingUnlockId = null;
  pendingUnlockAction = null;
  if (unlockDialog) unlockDialog.classList.add("hidden");
}

async function confirmUnlock() {
  if (!pendingUnlockId) return;
  const doc = findDocumentById(pendingUnlockId);
  if (!doc) return closeUnlockDialog();

  const valid = await verifyLockPassword(doc, unlockPassword.value);
  if (!valid) {
    unlockDialogError.textContent = "كلمة مرور القفل غير صحيحة.";
    unlockDialogError.classList.remove("hidden");
    return;
  }

  const action = pendingUnlockAction;
  const docId = pendingUnlockId;
  unlockDoc(docId);
  closeUnlockDialog();
  renderLibrary();

  if (action === "download") {
    downloadDocument(doc);
  } else {
    setStatus("تم فتح الملف المقفل.", true);
    setTimeout(() => setStatus("", false), 2000);
  }
}

async function ingestFiles(files) {
  if (!canUploadFiles()) {
    setStatus(
      isUsingDriveStorage()
        ? "يرجى تسجيل الدخول إلى Google Drive قبل رفع الملفات."
        : "تعذّر رفع الملفات. تحقق من إعدادات التخزين.",
      true
    );
    return;
  }

  ingestBtn.disabled = true;
  setStatus("جارٍ فهرسة الملفات…");
  try {
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      if (isImageFile(file.name)) {
        setStatus(`جارٍ استخراج النص من الصورة (OCR): ${file.name}…`);
      }
      const text = await extractText(file, arrayBuffer, {
        onOcrProgress: (progress) => {
          if (isImageFile(file.name)) {
            setStatus(`${formatOcrProgress(progress)} — ${file.name}`);
          }
        },
      });
      if (!text) throw new Error(`لم يُعثر على نص في ${file.name}`);
      const category = assignCategory(text, file.name, state.documents);
      const chunks = chunkText(text).map((content) => ({ content }));
      let driveFileId = null;
      if (isUsingDriveStorage()) {
        driveFileId = await uploadDocumentFile(
          category,
          file.name,
          new Blob([arrayBuffer], { type: file.type || "application/octet-stream" })
        );
      }
      state.documents.push({
        id: crypto.randomUUID(),
        filename: file.name,
        category,
        fileGroup: fileGroup(file.name),
        extension: fileExtension(file.name),
        charCount: text.length,
        preview: text.replace(/\s+/g, " ").slice(0, 280),
        fileData: driveFileId ? null : arrayBufferToBase64(arrayBuffer),
        driveFileId,
        storageBackend: isUsingDriveStorage()
          ? STORAGE_BACKENDS.DRIVE
          : isUsingGitHubStorage()
            ? STORAGE_BACKENDS.GITHUB
            : STORAGE_BACKENDS.LOCAL,
        chunks,
        isLocked: false,
        lockHash: null,
      });
    }
    await persistState();
    renderLibrary();
    setStatus(
      isUsingDriveStorage()
        ? "اكتملت الفهرسة وحُفظت في Google Drive حسب التصنيف."
        : isUsingGitHubStorage()
          ? "اكتملت الفهرسة وحُفظت في GitHub."
          : isCloudSyncEnabled()
            ? "اكتملت الفهرسة وحُفظت في التخزين السحابي."
            : "اكتملت الفهرسة.",
      true
    );
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    setStatus(`خطأ: ${error.message}`, true);
  } finally {
    ingestBtn.disabled = !pendingFiles.length;
    revokeAllPreviewUrls();
    pendingFiles = [];
    renderPendingFiles();
    fileInput.value = "";
  }
}

function setSearchResults(html) {
  searchResults.innerHTML = html;
  if (clearSearchBtn) clearSearchBtn.disabled = !html;
}

function clearSearchResults() {
  setSearchResults("");
}

function runSearch() {
  const query = searchQuery.value.trim();
  if (!query) {
    setSearchResults(`<p class="muted search-empty">أدخل عبارة البحث.</p>`);
    return;
  }
  const searchable = accessibleDocuments(state.documents);
  if (!searchable.length) {
    setSearchResults(`<p class="muted search-empty">ارفع مستندات أو افتح الملفات المقفلة قبل البحث.</p>`);
    return;
  }

  const searchOptions = readSearchOptionsFromForm();
  saveSearchOptions(searchOptions);

  searchBtn.disabled = true;
  try {
    const category = categoryFilter.value || null;
    const k = Number(resultCount.value);
    const top = advancedSearch(searchable, query, {
      ...searchOptions,
      category,
      limit: k,
    });
    const docMeta = new Map(
      searchable.map((doc) => [doc.id, { fileGroup: doc.fileGroup, extension: doc.extension }])
    );

    setSearchResults(renderSearchResults(top, query, docMeta, searchOptions));
    bindSearchResults(searchResults, { onDownload: handleDownload });
  } catch (error) {
    console.error(error);
    setSearchResults(`<p class="muted search-empty">تعذّر عرض النتائج: ${escapeHtml(error.message)}</p>`);
  } finally {
    searchBtn.disabled = false;
  }
}

logoutBtn.addEventListener("click", () => {
  sessionPassword = "";
  state = normalizeState({});
  currentUser = null;
  clearStorageSession();
  clearDriveSession();
  clearUnlockSession();
  authApi?.logout?.();
});

ingestBtn.addEventListener("click", () => {
  if (pendingFiles.length) ingestFiles(pendingFiles);
});

searchBtn.addEventListener("click", runSearch);
clearSearchBtn?.addEventListener("click", clearSearchResults);
searchQuery?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
resultCount.addEventListener("input", () => {
  resultCountLabel.textContent = resultCount.value;
});

if (deleteConfirmBtn) deleteConfirmBtn.addEventListener("click", confirmDelete);
if (deleteCancelBtn) deleteCancelBtn.addEventListener("click", closeDeleteDialog);
if (deleteDialogBackdrop) deleteDialogBackdrop.addEventListener("click", closeDeleteDialog);

if (lockConfirmBtn) lockConfirmBtn.addEventListener("click", confirmLock);
if (lockCancelBtn) lockCancelBtn.addEventListener("click", closeLockDialog);
if (lockDialogBackdrop) lockDialogBackdrop.addEventListener("click", closeLockDialog);

if (unlockConfirmBtn) unlockConfirmBtn.addEventListener("click", confirmUnlock);
if (unlockCancelBtn) unlockCancelBtn.addEventListener("click", closeUnlockDialog);
if (unlockDialogBackdrop) unlockDialogBackdrop.addEventListener("click", closeUnlockDialog);

unlockPassword?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmUnlock();
});
lockPasswordConfirm?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmLock();
});

driveLoginBtn?.addEventListener("click", handleDriveLogin);
driveLogoutBtn?.addEventListener("click", handleDriveLogout);
for (const input of document.querySelectorAll('input[name="storage-mode"]')) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    handleStorageModeChange(input.value);
  });
}

setupDropZone();
initImagePreview();
applySearchOptionsToForm(loadSearchOptions());
initTheme();

themeToggleBtn?.addEventListener("click", () => toggleTheme());
explorerToggleAllBtn?.addEventListener("click", () => {
  explorerShowAll = !explorerShowAll;
  renderLibrary();
});
advancedSearchPanel?.querySelectorAll("input").forEach((input) => {
  input.addEventListener("change", () => saveSearchOptions(readSearchOptionsFromForm()));
});

export async function startApp({ user, auth }) {
  currentUser = user;
  authApi = auth;
  sessionPassword = getVaultPassword();

  adminMembersApi = initAdminMembers({
    getActor: () => currentUser,
    onStatus: setStatus,
    isAdmin: () => authApi?.isAdmin?.(),
  });

  try {
    await hydrateDocuments(sessionPassword);
    applySearchOptionsToForm(loadSearchOptions());
    updateStoragePanel();
    updateUploadAccess();
    showView();
  } catch (error) {
    setStatus(`تعذّر تحميل المستندات: ${error.message}`, true);
    authApi?.logout?.();
  }
}
