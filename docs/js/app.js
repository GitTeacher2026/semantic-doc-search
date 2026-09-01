import {
  assignCategory,
} from "./bm25-search.js";
import { advancedSearch } from "./advanced-search.js?v=20260830b";
import {
  applySearchOptionsToForm,
  describeActiveSearchOptions,
  loadSearchOptions,
  readSearchOptionsFromForm,
  saveSearchOptions,
} from "./search-options.js?v=20260830b";
import {
  getActiveStorageBackend,
  STORAGE_BACKENDS,
} from "./document-storage.js";
import { initTheme, toggleTheme } from "./theme.js";
import { bytesToBase64 } from "./crypto.js";
import { bindSearchResults, renderSearchResults } from "./search-results.js?v=20260830b";
import {
  extractImageText,
  ensurePuterConnected,
  formatOcrProgress,
  getPuterEmail,
  getPuterUserLabel,
  isImageFile,
  isPuterConnected,
  isPuterPreconfigured,
  loginToPuter,
  logoutPuter,
} from "./ocr.js?v=20260901v";
import {
  getAvailableOcrEngines,
  loadOcrOptions,
  readOcrEngineFromForm,
  saveOcrOptions,
} from "./ocr-options.js";
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
  isFolderUnlocked,
  lockDocSession,
  lockFolderSession,
  unlockDoc,
  unlockFolder,
  verifyLockPassword,
} from "./file-lock.js";
import {
  applyGitHubRemoteSession,
  clearStorageSession,
  isCloudSyncEnabled,
  isUsingDriveStorage,
  isUsingGitHubStorage,
  isUsingMegaStorage,
  isUsingOneDriveStorage,
  isUsingRemoteFileStorage,
  loadDocuments,
  saveDocuments,
  setStorageUserId,
} from "./storage.js";
import {
  getAvailableStorageModes,
  getResolvedStorageMode,
  getStorageModeHint,
  getStorageModeLabel,
  setStorageMode,
  STORAGE_MODES,
} from "./storage-preference.js";
import {
  isDriveConnected,
  loginToGoogleDrive,
  logoutGoogleDrive,
} from "./drive-auth.js";
import { downloadDriveFile, renameDriveFile, uploadDocumentFile as uploadDriveDocumentFile } from "./drive-storage.js";
import { isMegaConnected, ensureMegaAutoLogin } from "./mega-auth.js";
import {
  downloadMegaFile,
  renameMegaFile,
  moveMegaFileToCategory,
  uploadDocumentFile as uploadMegaDocumentFile,
} from "./mega-storage.js";
import {
  isOneDriveConnected,
  loginToOneDrive,
  logoutOneDrive,
} from "./onedrive-auth.js";
import {
  downloadOneDriveFile,
  renameOneDriveFile,
  uploadDocumentFile as uploadOneDriveDocumentFile,
} from "./onedrive-storage.js";
import {
  approvePendingUser,
  rejectPendingUser,
  resendPendingSignupEmails,
} from "./auth-service.js";
import { initAdminMembers } from "./admin-members.js";
import { getVaultPassword } from "./auth-page.js";
import { initPasswordToggles } from "./password-toggle.js";
import {
  daysUntilPurge,
  moveToTrash,
  normalizeState,
  permanentlyDelete,
  purgeAllTrash,
  restoreFromTrash,
  TRASH_RETENTION_DAYS,
} from "./trash.js";
import {
  getFileBrowserState,
  initFileBrowser,
  renderFileBrowser,
  setFileBrowserState,
} from "./file-browser.js";
import {
  clearFolderLock,
  countDocumentsInFolder,
  deleteFolderFromState,
  ensureFolderRecord,
  getFolderByName,
  listFolderNames,
  renameFolderInState,
  setFolderLock,
  syncFoldersFromDocuments,
} from "./folders.js";
import {
  canSyncGitHubMega,
  describeSyncSummary,
  loadMergedGitHubMegaIndex,
  saveMergedGitHubMegaIndex,
  syncDocumentsGitHubMega,
} from "./storage-sync.js";
import { isGitHubStorageConfigured } from "./github-storage.js";
import {
  getUploadDestination,
  getUploadDestinationHint,
  getUploadDestinationLabel,
  getUploadDestinationOptions,
  hasUploadDestinationChoice,
  isUploadDestinationReady,
  setUploadDestination,
} from "./upload-destination.js";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const IMAGE_NO_OCR_PREVIEW = "صورة — لم يُستخرج نص بعد";

let currentAppPage = "library";
let pendingItems = [];
let state = normalizeState({});
let sessionPassword = "";
let isHydrating = false;
let pendingDeleteId = null;
let pendingRenameId = null;
let pendingLockId = null;
let pendingUnlockId = null;
let pendingUnlockAction = null;
let pendingOcrId = null;
let pendingFolderRenameName = null;
let pendingFolderLockName = null;
let pendingFolderUnlockName = null;
let pendingFolderUnlockCallback = null;
let pendingFolderUnlockCancel = null;
let pendingMoveTargetCategory = null;
let authApi = null;
let currentUser = null;
let adminMembersApi = null;
let dualIndexHandles = null;

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
const uploadDestinationPicker = document.getElementById("upload-destination-picker");
const uploadDestinationOptions = document.getElementById("upload-destination-options");
const uploadDestinationHint = document.getElementById("upload-destination-hint");
const puterConnectPanel = document.getElementById("puter-connect-panel");
const puterConnectTitle = document.getElementById("puter-connect-title");
const puterConnectHint = document.getElementById("puter-connect-hint");
const puterConnectBtn = document.getElementById("puter-connect-btn");
const puterDisconnectBtn = document.getElementById("puter-disconnect-btn");
const puterEmailInput = document.getElementById("puter-email");
const puterPasswordInput = document.getElementById("puter-password");
const pendingImagesNote = document.getElementById("pending-images-note");
const pendingFilesEl = document.getElementById("pending-files");
const ingestBtn = document.getElementById("ingest-btn");
const libraryFilesSummary = document.getElementById("library-files-summary");
const gotoFilesBtn = document.getElementById("goto-files-btn");
const fileBrowserRoot = document.getElementById("file-browser-root");
const advancedSearchPanel = document.getElementById("advanced-search-panel");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const trashMeta = document.getElementById("trash-meta");
const trashList = document.getElementById("trash-list");
const libraryPage = document.getElementById("library-page");
const filesPage = document.getElementById("files-page");
const trashPage = document.getElementById("trash-page");
const navLibraryBtn = document.getElementById("nav-library-btn");
const navFilesBtn = document.getElementById("nav-files-btn");
const navTrashBtn = document.getElementById("nav-trash-btn");
const trashBackBtn = document.getElementById("trash-back-btn");
const purgeAllTrashBtn = document.getElementById("purge-all-trash-btn");
const trashCountBadge = document.getElementById("trash-count-badge");
const filesCountBadge = document.getElementById("files-count-badge");
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

const renameDialog = document.getElementById("rename-dialog");
const renameDialogTitle = document.getElementById("rename-dialog-title");
const renameDialogSub = document.getElementById("rename-dialog-sub");
const renameFilename = document.getElementById("rename-filename");
const renameDialogError = document.getElementById("rename-dialog-error");
const renameConfirmBtn = document.getElementById("rename-confirm-btn");
const renameCancelBtn = document.getElementById("rename-cancel-btn");
const renameDialogBackdrop = document.getElementById("rename-dialog-backdrop");

const folderCreateDialog = document.getElementById("folder-create-dialog");
const folderCreateName = document.getElementById("folder-create-name");
const folderCreateError = document.getElementById("folder-create-dialog-error");
const folderCreateConfirmBtn = document.getElementById("folder-create-confirm-btn");
const folderCreateCancelBtn = document.getElementById("folder-create-cancel-btn");
const folderCreateDialogBackdrop = document.getElementById("folder-create-dialog-backdrop");

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

const ocrDialog = document.getElementById("ocr-dialog");
const ocrDialogFilename = document.getElementById("ocr-dialog-filename");
const ocrDialogStatus = document.getElementById("ocr-dialog-status");
const ocrExtractBtn = document.getElementById("ocr-extract-btn");
const ocrCancelBtn = document.getElementById("ocr-cancel-btn");
const ocrDialogBackdrop = document.getElementById("ocr-dialog-backdrop");

async function hydrateDocuments(password) {
  isHydrating = true;
  setStatus("جارٍ تحميل المستندات…");
  try {
    if (canSyncGitHubMega()) {
      const merged = await loadMergedGitHubMegaIndex(password);
      state = normalizeState(merged.state);
      dualIndexHandles = { github: merged.github, mega: merged.mega };
      applyGitHubRemoteSession(merged.github);
    } else {
      dualIndexHandles = null;
      state = normalizeState(await loadDocuments(password));
    }
    state.folders = syncFoldersFromDocuments(state.documents, state.folders);
    migrateDocumentOcrFlags(state.documents);
    renderLibrary();
    renderTrash();
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
  state.folders = syncFoldersFromDocuments(state.documents, state.folders);

  if (canSyncGitHubMega() && dualIndexHandles) {
    const saved = await saveMergedGitHubMegaIndex(sessionPassword, state, dualIndexHandles);
    dualIndexHandles = { github: saved.github, mega: saved.mega };
    applyGitHubRemoteSession(saved.github);
    return;
  }

  await saveDocuments(sessionPassword, state);
}

function isAuthed() {
  return Boolean(currentUser);
}

function canUploadFiles() {
  const dest = getUploadDestination();
  if (dest === STORAGE_MODES.GITHUB) return isUsingGitHubStorage();
  if (dest === STORAGE_MODES.MEGA) return isMegaConnected();
  return getResolvedStorageMode() === STORAGE_MODES.LOCAL;
}

async function attachRemoteFileTargets(category, filename, blob, fileBytes) {
  const dest = getUploadDestination();
  let fileData = null;
  let megaFileId = null;

  if (dest === STORAGE_MODES.GITHUB && isUsingGitHubStorage()) {
    fileData = arrayBufferToBase64(fileBytes);
  } else if (dest === STORAGE_MODES.MEGA && isMegaConnected()) {
    megaFileId = await uploadMegaDocumentFile(category, filename, blob);
  }

  return {
    fileData,
    megaFileId,
    driveFileId: null,
    onedriveFileId: null,
    storageBackend:
      dest === STORAGE_MODES.GITHUB
        ? STORAGE_BACKENDS.GITHUB
        : dest === STORAGE_MODES.MEGA
          ? STORAGE_BACKENDS.MEGA
          : STORAGE_BACKENDS.LOCAL,
  };
}

function updatePuterConnectPanel() {
  if (!puterConnectPanel) return;

  const preconfigured = isPuterPreconfigured();
  const connected = isPuterConnected();
  const loginFields = document.getElementById("puter-login-fields");
  const loginNote = puterConnectPanel.querySelector(".puter-login-note");

  puterConnectTitle.textContent = "Puter AI";
  puterConnectHint.textContent = preconfigured
    ? "جاهز — اضغط «استخراج النص» لبدء Puter AI تلقائياً."
    : connected
      ? `متصل — ${getPuterEmail() ? `آخر بريد: ${getPuterEmail()}` : "جاهز لاستخراج النص من الصور"}`
      : "أدخل رمز API من لوحة Puter، أو اترك كلمة المرور فارغة لفتح نافذة تسجيل Puter.";
  puterConnectBtn.textContent = connected ? "إعادة الاتصال" : "الاتصال بـ Puter";
  puterConnectBtn.classList.toggle("hidden", preconfigured);
  puterDisconnectBtn?.classList.toggle("hidden", preconfigured || !connected);
  loginFields?.classList.toggle("hidden", preconfigured);
  loginNote?.classList.toggle("hidden", preconfigured);

  if (puterEmailInput && !puterEmailInput.value) {
    puterEmailInput.value = getPuterEmail();
  }
}

async function refreshPuterConnectPanel() {
  updatePuterConnectPanel();
  if (!isPuterConnected()) return;
  try {
    const label = await getPuterUserLabel();
    if (label) {
      puterConnectHint.textContent = `متصل كـ ${label}`;
    }
  } catch {
    /* ignore */
  }
}

async function handlePuterConnect() {
  try {
    const inDialog = ocrDialog && !ocrDialog.classList.contains("hidden");
    if (inDialog) {
      setOcrDialogStatus("جارٍ الاتصال بـ Puter AI…");
    } else {
      setStatus("جارٍ الاتصال بـ Puter AI…");
    }
    await loginToPuter({
      email: puterEmailInput?.value,
      password: puterPasswordInput?.value,
    });
    if (puterPasswordInput) puterPasswordInput.value = "";
    await refreshPuterConnectPanel();
    if (inDialog) {
      setOcrDialogStatus("تم الاتصال بـ Puter AI.", false);
    } else {
      setStatus("تم الاتصال بـ Puter AI.", true);
      setTimeout(() => setStatus("", false), 2000);
    }
  } catch (error) {
    if (ocrDialog && !ocrDialog.classList.contains("hidden")) {
      setOcrDialogStatus(error.message, true);
    } else {
      setStatus(error.message, true);
    }
  }
}

function handlePuterDisconnect() {
  logoutPuter();
  if (puterPasswordInput) puterPasswordInput.value = "";
  updatePuterConnectPanel();
  setStatus("تم قطع اتصال Puter.", true);
  setTimeout(() => setStatus("", false), 2000);
}

function updateOcrEnginePanel() {
  const select = document.getElementById("ocr-engine");
  const hint = document.getElementById("ocr-engine-hint");
  if (!select) return;

  const saved = loadOcrOptions().engine;
  const engines = getAvailableOcrEngines();
  const previous = select.value;

  select.replaceChildren(
    ...engines.map((engine) => {
      const option = document.createElement("option");
      option.value = engine.id;
      option.textContent = engine.label;
      return option;
    })
  );

  const nextValue = engines.some((item) => item.id === saved)
    ? saved
    : engines.some((item) => item.id === previous)
      ? previous
      : engines[0]?.id;
  if (nextValue) select.value = nextValue;

  const active = engines.find((item) => item.id === select.value) || engines[0];
  if (hint && active?.hint) {
    hint.textContent = isPuterPreconfigured()
      ? "Puter AI مُعد مسبقاً — اضغط «استخراج النص» للبدء."
      : active.hint;
  }
  updatePuterConnectPanel();
  refreshPuterConnectPanel();
}

function updateUploadAccess() {
  renderUploadDestinationPicker();
  const allowed = canUploadFiles();
  dropZone?.classList.toggle("is-disabled", !allowed);
  if (fileInput) fileInput.disabled = !allowed;
  if (uploadDestinationHint && !allowed && hasUploadDestinationChoice()) {
    const dest = getUploadDestination();
    if (dest === STORAGE_MODES.MEGA && !isMegaConnected()) {
      uploadDestinationHint.textContent = "جارٍ الاتصال بـ MEGA… إن استمر التعطيل، حدّث الصفحة.";
    }
  }
  updateIngestButtonState();
}

function renderUploadDestinationPicker() {
  if (!uploadDestinationPicker || !uploadDestinationOptions) return;

  const options = getUploadDestinationOptions();
  const showPicker = options.length > 0;
  uploadDestinationPicker.classList.toggle("hidden", !showPicker);
  if (!showPicker) return;

  const selected = getUploadDestination();
  uploadDestinationOptions.innerHTML = options
    .map(
      (option) => `
      <label class="storage-mode-option">
        <input type="radio" name="upload-dest" value="${option.id}" ${option.id === selected ? "checked" : ""} />
        <span>${option.label}</span>
      </label>`
    )
    .join("");

  uploadDestinationOptions.querySelectorAll('input[name="upload-dest"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      setUploadDestination(input.value);
      updateUploadDestinationHint();
      updateUploadAccess();
    });
  });

  updateUploadDestinationHint();
}

function updateUploadDestinationHint() {
  if (!uploadDestinationHint) return;
  const dest = getUploadDestination();
  const label = getUploadDestinationLabel(dest);
  const hint = getUploadDestinationHint(dest);
  if (!isUploadDestinationReady(dest)) {
    uploadDestinationHint.textContent =
      dest === STORAGE_MODES.MEGA
        ? `وجهة ${label}: جارٍ الاتصال بـ MEGA…`
        : `وجهة ${label}: غير جاهزة حالياً.`;
    return;
  }
  uploadDestinationHint.textContent = `الرفع إلى ${label}. ${hint}`;
}

function getExistingCategories() {
  return listFolderNames(state.folders, state.documents);
}

function defaultFileBaseName(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function defaultImageBaseName(filename) {
  return defaultFileBaseName(filename);
}

function sanitizeCategoryInput(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function createPendingItem(file) {
  const image = isImageFile(file.name);
  return {
    file,
    meta: {
      displayName: image ? defaultImageBaseName(file.name) : defaultFileBaseName(file.name),
      folder: "",
      newFolder: "",
      customizeOpen: image,
    },
  };
}

function resolvePendingCategory(meta) {
  if (!meta) return "";
  if (meta.folder === "__new__") {
    return sanitizeCategoryInput(meta.newFolder);
  }
  return sanitizeCategoryInput(meta.folder);
}

function buildUploadFilename(displayName, originalName) {
  const base = sanitizeFilenameInput(displayName);
  if (!base) return "";
  const ext = fileExtension(originalName);
  if (!ext) return base;
  const withoutExt = base.replace(new RegExp(`\\.${ext}$`, "i"), "");
  return `${withoutExt}.${ext}`;
}

function isPendingImageReady(item) {
  if (!item?.meta || !isImageFile(item.file.name)) return true;
  const filename = buildUploadFilename(item.meta.displayName, item.file.name);
  const category = resolvePendingCategory(item.meta);
  return Boolean(filename && category);
}

function hasPendingCustomize(item) {
  const meta = item?.meta;
  if (!meta) return false;
  const category = resolvePendingCategory(meta);
  const customName = sanitizeFilenameInput(meta.displayName);
  const defaultName = defaultFileBaseName(item.file.name);
  return Boolean(category || (customName && customName !== defaultName));
}

async function requireFolderAccess(folderName) {
  const name = sanitizeCategoryInput(folderName);
  if (!name) return;
  const folder = getFolderByName(state.folders, name);
  if (!folder?.isLocked || isFolderUnlocked(name)) return;
  await new Promise((resolve, reject) => {
    openFolderUnlockDialog(name, {
      onSuccess: () => resolve(),
      onCancel: () => reject(new Error(`يلزم فتح المجلد المقفل «${name}» لإضافة ملفات إليه.`)),
    });
  });
}

function updateIngestButtonState() {
  if (!ingestBtn) return;
  const allowed = canUploadFiles();
  const hasItems = pendingItems.length > 0;
  const imagesReady = pendingItems.every((item) => isPendingImageReady(item));
  ingestBtn.disabled = !allowed || !hasItems || !imagesReady;
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

function migrateDocumentOcrFlags(documents) {
  for (const doc of documents) {
    if (!isImageFile(doc?.filename)) continue;
    if (doc.ocrExtracted === true || doc.ocrExtracted === false) continue;
    doc.ocrExtracted = Boolean((doc.charCount || 0) > 0 && doc.chunks?.length);
  }
}

function updatePendingImagesNote() {
  const hasImages = pendingItems.some((item) => isImageFile(item.file.name));
  pendingImagesNote?.classList.toggle("hidden", !hasImages);
}

function setPendingItems(items) {
  const files = items.map((item) => item.file);
  syncPreviewUrls(files, isImageFile);
  pendingItems = [...items];
  renderPendingFiles();
  updatePendingImagesNote();
  updateIngestButtonState();
}

function setPendingFiles(files) {
  setPendingItems(files.map((file) => createPendingItem(file)));
}

function setOcrDialogStatus(message, isError = false) {
  if (!ocrDialogStatus) return;
  if (!message) {
    ocrDialogStatus.textContent = "";
    ocrDialogStatus.classList.add("hidden");
    ocrDialogStatus.classList.remove("error");
    return;
  }
  ocrDialogStatus.textContent = message;
  ocrDialogStatus.classList.remove("hidden");
  ocrDialogStatus.classList.toggle("error", isError);
}

function renderPendingFolderOptions(selected = "") {
  const categories = getExistingCategories();
  const options = [
    `<option value=""${selected === "" ? " selected" : ""}>— اختر مجلداً —</option>`,
    ...categories.map((category) => {
      const locked = getFolderByName(state.folders, category)?.isLocked;
      const label = locked ? `${category} 🔒` : category;
      return `<option value="${escapeHtml(category)}"${selected === category ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }),
    `<option value="__new__"${selected === "__new__" ? " selected" : ""}>+ مجلد جديد…</option>`,
  ];
  return options.join("");
}

function renderPendingCustomizeFields(item, index, { required = false } = {}) {
  const meta = item.meta;
  const ready = !required || isPendingImageReady(item);
  const showNewFolder = meta.folder === "__new__";
  const nameLabel = isImageFile(item.file.name) ? "اسم الصورة" : "اسم الملف";
  return `
    <div class="pending-image-fields${ready ? "" : " is-incomplete"}">
      <label class="pending-image-label" for="pending-image-name-${index}">${nameLabel}</label>
      <input
        id="pending-image-name-${index}"
        class="pending-image-name-input"
        type="text"
        data-index="${index}"
        value="${escapeHtml(meta.displayName)}"
        placeholder="${required ? "مثال: مخطط الطابق الثاني" : "اتركه فارغاً لاستخدام الاسم الأصلي"}"
        autocomplete="off"
      />
      <label class="pending-image-label" for="pending-image-folder-${index}">المجلد / الموقع${required ? "" : " (اختياري)"}</label>
      <select id="pending-image-folder-${index}" class="pending-image-folder-select" data-index="${index}">
        ${renderPendingFolderOptions(meta.folder)}
      </select>
      <input
        class="pending-image-folder-new${showNewFolder ? "" : " hidden"}"
        type="text"
        data-index="${index}"
        value="${escapeHtml(meta.newFolder)}"
        placeholder="اسم المجلد الجديد"
        autocomplete="off"
      />
      <p class="pending-image-hint muted">
        ${required ? "مطلوب للصور — استخراج النص لاحقاً من صفحة الملفات." : "اختياري — إن تُرك فارغاً يُصنَّف الملف تلقائياً."}
        ${!required ? " المجلدات المقفلة تتطلب كلمة المرور." : " المجلدات المقفلة تتطلب كلمة المرور."}
      </p>
    </div>`;
}

function renderPendingImageFields(item, index) {
  return renderPendingCustomizeFields(item, index, { required: true });
}

function renderPendingFileCard(item, index) {
  const file = item.file;
  const image = isImageFile(file.name);
  const previewUrl = image ? ensurePreviewUrl(file) : "";
  const visual = image
    ? `<button type="button" class="pending-file-thumb" data-preview-index="${index}" aria-label="معاينة ${escapeHtml(file.name)}">
        <img src="${previewUrl}" alt="" loading="lazy" />
      </button>`
    : largeIconMarkup(fileGroup(file.name));

  if (image) {
    return `
      <article class="pending-file-card is-image">
        ${visual}
        ${renderPendingImageFields(item, index)}
        <div class="pending-file-footer">
          <span class="pending-file-size muted">${formatFileSize(file.size)} · ${escapeHtml(file.name)}</span>
          <button class="pending-file-remove" type="button" data-index="${index}">إزالة</button>
        </div>
      </article>`;
  }

  return `
    <article class="pending-file-card">
      ${visual}
      <div class="pending-file-name">${escapeHtml(file.name)}</div>
      <div class="pending-file-size">${formatFileSize(file.size)}</div>
      <details class="pending-customize"${item.meta.customizeOpen ? " open" : ""} data-index="${index}">
        <summary>تخصيص الاسم والمجلد (اختياري)</summary>
        ${renderPendingCustomizeFields(item, index, { required: false })}
      </details>
      <button class="pending-file-remove" type="button" data-index="${index}">إزالة</button>
    </article>`;
}

function bindPendingImageFields() {
  pendingFilesEl.querySelectorAll(".pending-customize").forEach((details) => {
    details.addEventListener("toggle", () => {
      const index = Number(details.dataset.index);
      const item = pendingItems[index];
      if (item?.meta) item.meta.customizeOpen = details.open;
    });
  });

  pendingFilesEl.querySelectorAll(".pending-image-name-input").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const item = pendingItems[index];
      if (!item?.meta) return;
      item.meta.displayName = input.value;
      updateIngestButtonState();
      if (isImageFile(item.file.name)) {
        input.closest(".pending-image-fields")?.classList.toggle("is-incomplete", !isPendingImageReady(item));
      }
    });
  });

  pendingFilesEl.querySelectorAll(".pending-image-folder-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const index = Number(select.dataset.index);
      const item = pendingItems[index];
      if (!item?.meta) return;
      const previous = item.meta.folder;
      const next = select.value;
      if (next && next !== "__new__") {
        const folder = getFolderByName(state.folders, next);
        if (folder?.isLocked && !isFolderUnlocked(next)) {
          try {
            await requireFolderAccess(next);
          } catch (error) {
            select.value = previous;
            setStatus(error.message, true);
            return;
          }
        }
      }
      item.meta.folder = next;
      const card = select.closest(".pending-file-card");
      const newInput = card?.querySelector(".pending-image-folder-new");
      if (newInput) {
        newInput.classList.toggle("hidden", next !== "__new__");
        if (next !== "__new__") {
          item.meta.newFolder = "";
          newInput.value = "";
        } else {
          newInput.focus();
        }
      }
      updateIngestButtonState();
      if (isImageFile(item.file.name)) {
        card?.querySelector(".pending-image-fields")?.classList.toggle("is-incomplete", !isPendingImageReady(item));
      }
    });
  });

  pendingFilesEl.querySelectorAll(".pending-image-folder-new").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const item = pendingItems[index];
      if (!item?.meta) return;
      item.meta.newFolder = input.value;
      updateIngestButtonState();
      if (isImageFile(item.file.name)) {
        input.closest(".pending-image-fields")?.classList.toggle("is-incomplete", !isPendingImageReady(item));
      }
    });
  });
}

function renderPendingFiles() {
  if (!pendingItems.length) {
    pendingFilesEl.classList.add("hidden");
    pendingFilesEl.classList.remove("has-images");
    pendingFilesEl.innerHTML = "";
    return;
  }

  const hasImages = pendingItems.some((item) => isImageFile(item.file.name));
  const hasDocs = pendingItems.some((item) => !isImageFile(item.file.name));
  pendingFilesEl.classList.remove("hidden");
  pendingFilesEl.classList.toggle("has-images", hasImages);
  pendingFilesEl.classList.toggle("has-mixed", hasImages && hasDocs);
  pendingFilesEl.innerHTML = pendingItems
    .map((item, index) => renderPendingFileCard(item, index))
    .join("");

  pendingFilesEl.querySelectorAll(".pending-file-thumb").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.previewIndex);
      const file = pendingItems[index]?.file;
      if (!file) return;
      const url = ensurePreviewUrl(file);
      if (url) openImagePreview(url, file.name);
    });
  });

  pendingFilesEl.querySelectorAll(".pending-file-remove").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = Number(btn.dataset.index);
      setPendingItems(pendingItems.filter((_, i) => i !== index));
    });
  });

  bindPendingImageFields();
  updateIngestButtonState();
}

function setupDropZone() {
  const addFiles = (fileList) => {
    if (!fileList?.length) return;
    if (!canUploadFiles()) {
      setStatus("تعذّر رفع الملفات. تحقق من إعدادات التخزين.", true);
      return;
    }
    const merged = [...pendingItems, ...fileList.map((file) => createPendingItem(file))];
    setPendingItems(merged);
  };

  dropZone.addEventListener("click", (event) => {
    if (!canUploadFiles()) {
      event.preventDefault();
      setStatus("تعذّر رفع الملفات. تحقق من إعدادات التخزين.", true);
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
      setStatus("تعذّر رفع الملفات. تحقق من إعدادات التخزين.", true);
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
  // PDF.js may transfer/detach the buffer — always pass a copy.
  const data = arrayBuffer.slice(0);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => item.str).join(" "));
  }
  return parts.join("\n").trim();
}

async function extractText(file, arrayBuffer) {
  const name = String(file?.name || "");
  const buffer = arrayBuffer || (await file.arrayBuffer());
  if (isImageFile(name)) {
    throw new Error("استخراج نص الصور يتم من صفحة الملفات بعد الفهرسة.");
  }
  if (fileEndsWith(name, ".pdf")) return extractPdfText(buffer);
  if (fileEndsWith(name, ".docx")) return extractDocxText(buffer);
  if (fileEndsWith(name, ".xlsx") || fileEndsWith(name, ".xls")) return extractExcelText(buffer);
  if (fileEndsWith(name, ".pptx")) return extractPptxText(buffer);
  if (fileEndsWith(name, ".doc") || fileEndsWith(name, ".ppt")) {
    throw new Error(`${name}: صيغ .doc و .ppt القديمة غير مدعومة في المتصفح. استخدم docx/pptx.`);
  }
  if (EXT_GROUPS.text.some((ext) => fileEndsWith(name, ext))) {
    return decodeUtf8Text(buffer);
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

function updateLibraryFilesSummary(docs) {
  const count = docs?.length || 0;
  if (libraryFilesSummary) {
    libraryFilesSummary.textContent = count
      ? `${count.toLocaleString("ar-EG")} ملف مفهرس — تصفّحها من مستكشف الملفات.`
      : "لا توجد ملفات مفهرسة بعد. ارفع ملفات ثم اضغط «فهرسة وتصنيف».";
  }
  if (filesCountBadge) {
    if (count > 0) {
      filesCountBadge.textContent = String(count);
      filesCountBadge.classList.remove("hidden");
    } else {
      filesCountBadge.classList.add("hidden");
    }
  }
}

function renderFilesPage() {
  renderFileBrowser(state.documents, {
    folders: state.folders,
    syncAvailable: canSyncGitHubMega(),
    dualSources: canSyncGitHubMega(),
    onChange: renderFilesPage,
  });
}

async function executeMoveDocumentToCategory(doc, category) {
  const nextCategory = sanitizeCategoryInput(category);
  if (!nextCategory || nextCategory === (doc.category || "عام")) return;
  await requireFolderAccess(nextCategory);

  if (doc.megaFileId) {
    setStatus(`جارٍ نقل «${doc.filename}» إلى ${nextCategory}…`);
    doc.megaFileId = await moveMegaFileToCategory(doc.megaFileId, doc.filename, nextCategory);
  }

  doc.category = nextCategory;
  state.folders = ensureFolderRecord(state.folders, nextCategory);
  await persistState();
  renderLibrary();
  setStatus(`تم نقل «${doc.filename}» إلى ${nextCategory}.`, true);
  setTimeout(() => setStatus("", false), 2000);
}

async function moveDocumentToCategory(docId, targetCategory) {
  const doc = findDocumentById(docId);
  if (!doc) return;
  if (doc.isLocked && !isDocUnlocked(doc)) {
    pendingMoveTargetCategory = targetCategory;
    openUnlockDialog(docId, "move");
    return;
  }
  try {
    await executeMoveDocumentToCategory(doc, targetCategory);
  } catch (error) {
    setStatus(`تعذّر نقل الملف: ${error.message}`, true);
  }
}

async function ingestExternalFilesToCategory(fileList, category) {
  if (!canUploadFiles()) {
    setStatus("تعذّر رفع الملفات. تحقق من إعدادات التخزين.", true);
    return;
  }
  const files = [...fileList];
  if (!files.length) return;

  try {
    if (category) await requireFolderAccess(category);
    const items = files.map((file) => {
      const item = createPendingItem(file);
      if (category) item.meta.folder = category;
      return item;
    });
    await ingestFiles(items);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleSyncGitHubMega() {
  if (!canSyncGitHubMega()) {
    setStatus("يلزم ضبط GitHub والاتصال بـ MEGA للمزامنة.", true);
    return;
  }
  if (
    !window.confirm(
      "مزامنة الملفات بين GitHub و MEGA؟\nسيتم نسخ كل ملف ليظهر في كلا المصدرين (قد يستغرق وقتاً)."
    )
  ) {
    return;
  }

  try {
    setStatus("جارٍ تحميل الفهارس من GitHub و MEGA…");
    const merged = await loadMergedGitHubMegaIndex(sessionPassword);
    state = normalizeState(merged.state);
    state.folders = syncFoldersFromDocuments(state.documents, state.folders);
    dualIndexHandles = { github: merged.github, mega: merged.mega };
    applyGitHubRemoteSession(merged.github);

    setStatus("جارٍ المزامنة بين GitHub و MEGA…");
    const result = await syncDocumentsGitHubMega(state.documents, {
      onProgress: ({ index, total, filename }) => {
        setStatus(`مزامنة ${index}/${total}: ${filename}…`);
      },
    });
    state.documents = result.documents;
    state.folders = syncFoldersFromDocuments(state.documents, state.folders);

    setStatus("جارٍ حفظ الفهارس في GitHub و MEGA…");
    const saved = await saveMergedGitHubMegaIndex(sessionPassword, state, dualIndexHandles);
    dualIndexHandles = { github: saved.github, mega: saved.mega };
    applyGitHubRemoteSession(saved.github);
    renderLibrary();
    setStatus(describeSyncSummary(result), true);
    setTimeout(() => setStatus("", false), 3500);
  } catch (error) {
    setStatus(`تعذّرت المزامنة: ${error.message}`, true);
  }
}

function renderLibrary() {
  const docs = state.documents;
  const categories = summarizeCategories(docs);

  categoryFilter.innerHTML = `<option value="">جميع التصنيفات</option>${categories
    .map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("")}`;

  updateLibraryFilesSummary(docs);

  if (currentAppPage === "files") {
    renderFilesPage();
  }
}

function switchAppPage(page) {
  currentAppPage = page;
  const isTrash = page === "trash";
  const isFiles = page === "files";
  libraryPage?.classList.toggle("hidden", isTrash || isFiles);
  filesPage?.classList.toggle("hidden", !isFiles);
  trashPage?.classList.toggle("hidden", !isTrash);
  navLibraryBtn?.classList.toggle("active", page === "library");
  navFilesBtn?.classList.toggle("active", isFiles);
  navTrashBtn?.classList.toggle("active", isTrash);
  if (isTrash) renderTrash();
  if (isFiles) renderFilesPage();
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
navFilesBtn?.addEventListener("click", () => switchAppPage("files"));
navTrashBtn?.addEventListener("click", () => switchAppPage("trash"));
gotoFilesBtn?.addEventListener("click", () => switchAppPage("files"));
trashBackBtn?.addEventListener("click", () => switchAppPage("library"));
purgeAllTrashBtn?.addEventListener("click", async () => {
  const count = (state.trash || []).length;
  if (!count) return;
  if (
    !window.confirm(
      `إفراغ سلة المهملات نهائياً؟\nسيتم حذف ${count} ملف بشكل دائم ولا يمكن التراجع.`
    )
  ) {
    return;
  }
  state = purgeAllTrash(state);
  try {
    setStatus("جارٍ إفراغ سلة المهملات…");
    await persistState();
    renderTrash();
    setStatus("تم إفراغ سلة المهملات.", true);
    setTimeout(() => setStatus("", false), 2000);
  } catch (error) {
    setStatus(`تعذّر إفراغ السلة: ${error.message}`, true);
  }
});

function summarizeCategories(documents) {
  const counts = new Map();
  for (const doc of documents) counts.set(doc.category, (counts.get(doc.category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"));
}

function renderTrash() {
  const trash = state.trash || [];
  updateTrashBadge();
  trashMeta.textContent =
    trash.length === 0
      ? `سلة المهملات فارغة. الملفات المحذوفة تُحذف نهائياً بعد ${TRASH_RETENTION_DAYS} يوماً.`
      : `${trash.length} ملف في السلة — يُحذف تلقائياً بعد ${TRASH_RETENTION_DAYS} يوماً.`;

  purgeAllTrashBtn?.classList.toggle("hidden", trash.length === 0);

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

function decodeUtf8Text(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trim();
}

function arrayBufferToBase64(buffer) {
  return bytesToBase64(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
}

function findDocumentById(id) {
  return state.documents.find((doc) => doc.id === id);
}

function guessImageMime(filename) {
  const ext = fileExtension(filename).toLowerCase();
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return map[ext] || "image/jpeg";
}

async function getDocumentBlob(doc) {
  let bytes;
  if (doc.fileData) {
    bytes = Uint8Array.from(atob(doc.fileData), (char) => char.charCodeAt(0));
  } else if (doc.driveFileId) {
    bytes = new Uint8Array(await downloadDriveFile(doc.driveFileId));
  } else if (doc.megaFileId) {
    bytes = new Uint8Array(await downloadMegaFile(doc.megaFileId));
  } else if (doc.onedriveFileId) {
    bytes = new Uint8Array(await downloadOneDriveFile(doc.onedriveFileId));
  } else {
    throw new Error("تعذّر الوصول إلى ملف الصورة. أعد رفع الصورة.");
  }
  return new Blob([bytes], { type: guessImageMime(doc.filename) });
}

async function extractOcrForDocument(doc) {
  const blob = await getDocumentBlob(doc);
  const result = await extractImageText(blob, (progress) => {
    setOcrDialogStatus(`${formatOcrProgress(progress)} — ${doc.filename}`);
  }, { engine: readOcrEngineFromForm(ocrDialog || document) });
  const text = typeof result === "string" ? result : result.text;
  if (!text) throw new Error("لم يُعثر على نص في الصورة.");
  return text;
}

async function openOcrDialog(docId) {
  const doc = findDocumentById(docId);
  if (!doc || !isImageFile(doc.filename)) return;
  if (doc.isLocked && !isDocUnlocked(doc)) {
    openUnlockDialog(docId, "ocr");
    return;
  }

  pendingOcrId = docId;
  if (ocrDialogFilename) {
    ocrDialogFilename.textContent = doc.ocrExtracted
      ? `إعادة استخراج النص من: ${doc.filename}`
      : `الملف: ${doc.filename}`;
  }
  setOcrDialogStatus("");
  updateOcrEnginePanel();
  ocrExtractBtn.disabled = false;
  ocrDialog?.classList.remove("hidden");

  if (isPuterPreconfigured()) {
    try {
      setOcrDialogStatus("جارٍ تجهيز Puter AI…");
      await ensurePuterConnected();
      setOcrDialogStatus("");
    } catch (error) {
      setOcrDialogStatus(error.message, true);
    }
  }
}

function closeOcrDialog() {
  pendingOcrId = null;
  setOcrDialogStatus("");
  ocrExtractBtn.disabled = false;
  ocrDialog?.classList.add("hidden");
}

async function confirmOcrExtract() {
  if (!pendingOcrId) return;
  const doc = findDocumentById(pendingOcrId);
  if (!doc) return closeOcrDialog();

  ocrExtractBtn.disabled = true;
  setOcrDialogStatus(`جارٍ استخراج النص من ${doc.filename}…`);
  try {
    const text = await extractOcrForDocument(doc);
    const category = assignCategory(text, doc.filename, state.documents.filter((item) => item.id !== doc.id));
    doc.category = category;
    doc.charCount = text.length;
    doc.preview = text.replace(/\s+/g, " ").slice(0, 280);
    doc.chunks = chunkText(text).map((content) => ({ content }));
    doc.ocrExtracted = true;

    setStatus("جارٍ حفظ النص المستخرج…");
    await persistState();
    renderLibrary();
    setOcrDialogStatus("تم استخراج النص وحفظه بنجاح.", false);
    setStatus("تم استخراج النص من الصورة.", true);
    setTimeout(() => {
      closeOcrDialog();
      setStatus("", false);
    }, 1200);
  } catch (error) {
    setOcrDialogStatus(error.message, true);
    setStatus(`تعذّر استخراج النص: ${error.message}`, true);
    ocrExtractBtn.disabled = false;
  }
}

async function downloadDocument(doc) {
  try {
    let bytes;
    if (doc.fileData) {
      bytes = Uint8Array.from(atob(doc.fileData), (char) => char.charCodeAt(0));
    } else if (doc.driveFileId) {
      const buffer = await downloadDriveFile(doc.driveFileId);
      bytes = new Uint8Array(buffer);
    } else if (doc.megaFileId) {
      const buffer = await downloadMegaFile(doc.megaFileId);
      bytes = new Uint8Array(buffer);
    } else if (doc.onedriveFileId) {
      const buffer = await downloadOneDriveFile(doc.onedriveFileId);
      bytes = new Uint8Array(buffer);
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

function sanitizeFilenameInput(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function hasDuplicateFilename(filename, excludeId = null) {
  const target = filename.trim().toLowerCase();
  return state.documents.some(
    (doc) => doc.id !== excludeId && String(doc.filename || "").trim().toLowerCase() === target
  );
}

function hasDuplicateFolderName(name) {
  const target = sanitizeCategoryInput(name);
  if (!target) return false;
  return Boolean(getFolderByName(state.folders, target));
}

function openFolderRenameDialog(folderName) {
  if (!renameDialog) return;
  pendingFolderRenameName = folderName;
  pendingRenameId = null;
  renameDialogTitle.textContent = "إعادة تسمية المجلد";
  renameDialogSub.textContent = `المجلد الحالي: ${folderName}`;
  renameFilename.value = folderName;
  renameDialogError.classList.add("hidden");
  renameDialog.classList.remove("hidden");
  renameFilename.focus();
  renameFilename.select();
}

function openFolderCreateDialog() {
  if (!folderCreateDialog) return;
  folderCreateName.value = "";
  folderCreateError.classList.add("hidden");
  folderCreateDialog.classList.remove("hidden");
  folderCreateName.focus();
}

function closeFolderCreateDialog() {
  folderCreateDialog?.classList.add("hidden");
  folderCreateError?.classList.add("hidden");
}

async function confirmFolderCreate() {
  const name = sanitizeCategoryInput(folderCreateName?.value);
  if (!name) {
    folderCreateError.textContent = "أدخل اسماً صالحاً للمجلد.";
    folderCreateError.classList.remove("hidden");
    return;
  }
  if (hasDuplicateFolderName(name)) {
    folderCreateError.textContent = `المجلد «${name}» موجود بالفعل.`;
    folderCreateError.classList.remove("hidden");
    return;
  }

  try {
    setStatus("جارٍ إنشاء المجلد…");
    state.folders = ensureFolderRecord(state.folders, name);
    await persistState();
    closeFolderCreateDialog();
    setFileBrowserState({ category: name, group: null });
    renderLibrary();
    setStatus(`تم إنشاء المجلد «${name}».`, true);
    setTimeout(() => setStatus("", false), 2000);
  } catch (error) {
    folderCreateError.textContent = error.message;
    folderCreateError.classList.remove("hidden");
  }
}

async function handleFolderDelete(folderName) {
  const count = countDocumentsInFolder(state.documents, folderName);
  if (
    !window.confirm(
      count
        ? `حذف مجلد «${folderName}» ونقل ${count} ملف إلى سلة المهملات؟`
        : `حذف مجلد «${folderName}» الفارغ؟`
    )
  ) {
    return;
  }
  try {
    setStatus("جارٍ حذف المجلد…");
    state = deleteFolderFromState(state, folderName);
    lockFolderSession(folderName);
    const browser = getFileBrowserState();
    if (browser?.category === folderName) {
      setFileBrowserState({ category: null, group: null });
    }
    await persistState();
    renderLibrary();
    setStatus("تم حذف المجلد.", true);
    setTimeout(() => setStatus("", false), 2000);
  } catch (error) {
    setStatus(`تعذّر حذف المجلد: ${error.message}`, true);
  }
}

function openFolderLockDialog(folderName) {
  if (!lockDialog) return;
  pendingFolderLockName = folderName;
  pendingLockId = null;
  lockDialogTitle.textContent = `قفل مجلد «${folderName}»`;
  lockDialogSub.textContent = "أدخل كلمة مرور لحماية محتويات هذا المجلد. لن تُعرض الملفات حتى تفتح المجلد.";
  lockPassword.value = "";
  lockPasswordConfirm.value = "";
  lockDialogError.classList.add("hidden");
  lockDialog.classList.remove("hidden");
  lockPassword.focus();
}

function openFolderUnlockDialog(folderName, { onSuccess, onCancel } = {}) {
  if (!unlockDialog) return;
  pendingFolderUnlockName = folderName;
  pendingFolderUnlockCallback = onSuccess || null;
  pendingFolderUnlockCancel = onCancel || null;
  pendingUnlockId = null;
  pendingUnlockAction = null;
  unlockDialogTitle.textContent = `فتح مجلد «${folderName}»`;
  unlockDialogSub.textContent = "أدخل كلمة مرور المجلد للوصول إلى محتوياته.";
  unlockPassword.value = "";
  unlockDialogError.classList.add("hidden");
  unlockDialog.classList.remove("hidden");
  unlockPassword.focus();
}

function openRenameDialog(docId) {
  const doc = findDocumentById(docId);
  if (!doc || !renameDialog) return;
  pendingFolderRenameName = null;
  pendingRenameId = docId;
  renameDialogTitle.textContent = "إعادة تسمية الملف";
  renameDialogSub.textContent = `الاسم الحالي: ${doc.filename}`;
  renameFilename.value = doc.filename;
  renameDialogError.classList.add("hidden");
  renameDialog.classList.remove("hidden");
  renameFilename.focus();
  renameFilename.select();
}

function closeRenameDialog() {
  pendingRenameId = null;
  pendingFolderRenameName = null;
  if (renameDialog) renameDialog.classList.add("hidden");
  if (renameFilename) renameFilename.value = "";
  renameDialogError?.classList.add("hidden");
}

async function confirmRename() {
  if (pendingFolderRenameName) {
    const nextName = sanitizeCategoryInput(renameFilename.value);
    if (!nextName) {
      renameDialogError.textContent = "أدخل اسماً صالحاً للمجلد.";
      renameDialogError.classList.remove("hidden");
      return;
    }
    if (nextName === pendingFolderRenameName) {
      closeRenameDialog();
      return;
    }
    if (getFolderByName(state.folders, nextName) || state.documents.some((doc) => doc.category === nextName)) {
      renameDialogError.textContent = "يوجد مجلد آخر بنفس الاسم.";
      renameDialogError.classList.remove("hidden");
      return;
    }
    try {
      const oldName = pendingFolderRenameName;
      state = renameFolderInState(state, oldName, nextName);
      if (isFolderUnlocked(oldName)) {
        lockFolderSession(oldName);
        unlockFolder(nextName);
      }
      const browser = getFileBrowserState();
      if (browser?.category === oldName) {
        setFileBrowserState({ category: nextName, group: null });
      }
      await persistState();
      closeRenameDialog();
      renderLibrary();
      setStatus(`تمت إعادة تسمية المجلد إلى «${nextName}».`, true);
      setTimeout(() => setStatus("", false), 2000);
    } catch (error) {
      renameDialogError.textContent = error.message;
      renameDialogError.classList.remove("hidden");
    }
    return;
  }

  if (!pendingRenameId) return;
  const doc = findDocumentById(pendingRenameId);
  if (!doc) return closeRenameDialog();

  const nextName = sanitizeFilenameInput(renameFilename.value);
  if (!nextName) {
    renameDialogError.textContent = "أدخل اسماً صالحاً للملف.";
    renameDialogError.classList.remove("hidden");
    return;
  }
  if (nextName === doc.filename) {
    closeRenameDialog();
    return;
  }
  if (hasDuplicateFilename(nextName, doc.id)) {
    renameDialogError.textContent = "يوجد ملف آخر بنفس الاسم.";
    renameDialogError.classList.remove("hidden");
    return;
  }

  renameConfirmBtn.disabled = true;
  renameDialogError.classList.add("hidden");
  setStatus(`جارٍ إعادة تسمية «${doc.filename}»…`);

  try {
    if (doc.driveFileId) {
      const renamed = await renameDriveFile(doc.driveFileId, nextName);
      doc.filename = renamed;
    } else if (doc.megaFileId) {
      const renamed = await renameMegaFile(doc.megaFileId, nextName);
      doc.filename = renamed;
    } else if (doc.onedriveFileId) {
      const renamed = await renameOneDriveFile(doc.onedriveFileId, nextName);
      doc.filename = renamed;
    } else {
      doc.filename = nextName;
    }
    doc.extension = fileExtension(nextName);
    doc.fileGroup = fileGroup(nextName);
    await persistState();
    closeRenameDialog();
    renderLibrary();
    setStatus(`تمت إعادة التسمية إلى «${nextName}».`, true);
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    renameDialogError.textContent = error.message;
    renameDialogError.classList.remove("hidden");
    setStatus(`تعذّرت إعادة التسمية: ${error.message}`, true);
  } finally {
    renameConfirmBtn.disabled = false;
  }
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
  pendingFolderLockName = null;
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
  pendingFolderLockName = null;
  if (lockDialog) lockDialog.classList.add("hidden");
}

async function confirmLock() {
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

  if (pendingFolderLockName) {
    try {
      state = setFolderLock(state, pendingFolderLockName, await hashPassword(password));
      state.folders = ensureFolderRecord(state.folders, pendingFolderLockName);
      lockFolderSession(pendingFolderLockName);
      closeLockDialog();
      await persistState();
      renderLibrary();
      setStatus("تم قفل المجلد.", true);
      setTimeout(() => setStatus("", false), 2000);
    } catch (error) {
      setStatus(`تعذّر قفل المجلد: ${error.message}`, true);
    }
    return;
  }

  if (!pendingLockId) return;

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
  pendingFolderUnlockName = null;
  pendingFolderUnlockCallback = null;
  pendingFolderUnlockCancel = null;
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
  if (pendingFolderUnlockName && pendingFolderUnlockCancel) {
    pendingFolderUnlockCancel();
  }
  pendingUnlockId = null;
  pendingUnlockAction = null;
  pendingFolderUnlockName = null;
  pendingFolderUnlockCallback = null;
  pendingFolderUnlockCancel = null;
  pendingMoveTargetCategory = null;
  if (unlockDialog) unlockDialog.classList.add("hidden");
}

async function confirmUnlock() {
  if (pendingFolderUnlockName) {
    const folder = getFolderByName(state.folders, pendingFolderUnlockName);
    const valid = await verifyLockPassword(folder, unlockPassword.value);
    if (!valid) {
      unlockDialogError.textContent = "كلمة مرور المجلد غير صحيحة.";
      unlockDialogError.classList.remove("hidden");
      return;
    }
    unlockFolder(pendingFolderUnlockName);
    const callback = pendingFolderUnlockCallback;
    closeUnlockDialog();
    renderLibrary();
    callback?.();
    return;
  }

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
  } else if (action === "ocr") {
    openOcrDialog(docId);
  } else if (action === "move" && pendingMoveTargetCategory) {
    await executeMoveDocumentToCategory(doc, pendingMoveTargetCategory);
    pendingMoveTargetCategory = null;
  } else {
    setStatus("تم فتح الملف المقفل.", true);
    setTimeout(() => setStatus("", false), 2000);
  }
}

async function ingestFiles(items) {
  if (!canUploadFiles()) {
    setStatus("تعذّر رفع الملفات. تحقق من إعدادات التخزين.", true);
    return;
  }

  ingestBtn.disabled = true;
  setStatus("جارٍ فهرسة الملفات…");
  const documentsBefore = state.documents.length;
  try {
    for (const item of items) {
      const file = item.file;
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const image = isImageFile(file.name);
      const blob = new Blob([fileBytes]);

      if (image) {
        const uploadName = buildUploadFilename(item.meta?.displayName, file.name);
        const category = resolvePendingCategory(item.meta);
        if (!uploadName) {
          throw new Error("أدخل اسماً صالحاً لكل صورة قبل الفهرسة.");
        }
        if (!category) {
          throw new Error(`اختر مجلداً أو أنشئ مجلداً جديداً للصورة «${uploadName}».`);
        }
        await requireFolderAccess(category);
        state.folders = ensureFolderRecord(state.folders, category);
        if (hasDuplicateFilename(uploadName)) {
          throw new Error(`يوجد ملف بنفس الاسم «${uploadName}». غيّر الاسم أو احذف النسخة القديمة.`);
        }

        const remoteTargets = await attachRemoteFileTargets(
          category,
          uploadName,
          blob,
          fileBytes
        );

        state.documents.push({
          id: crypto.randomUUID(),
          filename: uploadName,
          category,
          ownerId: currentUser?.id,
          fileGroup: fileGroup(uploadName),
          extension: fileExtension(uploadName),
          charCount: 0,
          preview: IMAGE_NO_OCR_PREVIEW,
          ...remoteTargets,
          chunks: [],
          ocrExtracted: false,
          isLocked: false,
          lockHash: null,
        });
        state.folders = ensureFolderRecord(state.folders, category);
        continue;
      }

      const text = await extractText(file, fileBytes.slice().buffer);
      if (!text) throw new Error(`لم يُعثر على نص في ${file.name}`);

      let filename = file.name;
      let category = assignCategory(text, file.name, state.documents);
      const chosenCategory = resolvePendingCategory(item.meta);
      if (chosenCategory) {
        await requireFolderAccess(chosenCategory);
        category = chosenCategory;
        state.folders = ensureFolderRecord(state.folders, category);
      }
      const chosenName = buildUploadFilename(item.meta?.displayName, file.name);
      if (chosenName && sanitizeFilenameInput(item.meta?.displayName)) {
        filename = chosenName;
      }
      if (hasDuplicateFilename(filename)) {
        throw new Error(`يوجد ملف بنفس الاسم «${filename}». غيّر الاسم أو احذف النسخة القديمة.`);
      }

      const chunks = chunkText(text).map((content) => ({ content }));
      const remoteTargets = await attachRemoteFileTargets(
        category,
        filename,
        blob,
        fileBytes
      );

      state.documents.push({
        id: crypto.randomUUID(),
        filename,
        category,
        ownerId: currentUser?.id,
        fileGroup: fileGroup(filename),
        extension: fileExtension(filename),
        charCount: text.length,
        preview: text.replace(/\s+/g, " ").slice(0, 280),
        ...remoteTargets,
        chunks,
        isLocked: false,
        lockHash: null,
      });
    }
    setStatus("جارٍ حفظ المستندات…");
    await persistState();
    renderLibrary();
    setStatus(
      `اكتملت الفهرسة وحُفظت في ${getUploadDestinationLabel()}.`,
      true
    );
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    state.documents = state.documents.slice(0, documentsBefore);
    const hint = /bad credentials|DOCSHELF_GITHUB_TOKEN/i.test(error.message || "")
      ? " (تحقق من إعداد DOCSHELF_GITHUB_TOKEN في GitHub Actions.)"
      : "";
    setStatus(`خطأ: ${error.message}${hint}`, true);
  } finally {
    updateIngestButtonState();
    revokeAllPreviewUrls();
    pendingItems = [];
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

function getSearchableDocuments() {
  return accessibleDocuments(state.documents).filter((doc) => {
    const folder = getFolderByName(state.folders, doc.category || "عام");
    if (!folder?.isLocked) return true;
    return isFolderUnlocked(folder.name);
  });
}

function runSearch() {
  const query = searchQuery.value.trim();
  if (!query) {
    setSearchResults(`<p class="muted search-empty">أدخل عبارة البحث.</p>`);
    return;
  }
  const searchable = getSearchableDocuments();
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

    setSearchResults(
      renderSearchResults(top, query, docMeta, {
        ...searchOptions,
        labels: describeActiveSearchOptions(searchOptions),
      })
    );
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
  dualIndexHandles = null;
  clearStorageSession();
  clearUnlockSession();
  authApi?.logout?.();
});

ingestBtn.addEventListener("click", () => {
  if (pendingItems.length) ingestFiles(pendingItems);
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

if (renameConfirmBtn) renameConfirmBtn.addEventListener("click", confirmRename);
if (renameCancelBtn) renameCancelBtn.addEventListener("click", closeRenameDialog);
if (renameDialogBackdrop) renameDialogBackdrop.addEventListener("click", closeRenameDialog);
renameFilename?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmRename();
});

if (folderCreateConfirmBtn) folderCreateConfirmBtn.addEventListener("click", confirmFolderCreate);
if (folderCreateCancelBtn) folderCreateCancelBtn.addEventListener("click", closeFolderCreateDialog);
if (folderCreateDialogBackdrop) folderCreateDialogBackdrop.addEventListener("click", closeFolderCreateDialog);
folderCreateName?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmFolderCreate();
});

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

function handleFolderUnlock(folderName, onSuccess) {
  const folder = getFolderByName(state.folders, folderName);
  if (!folder?.isLocked || isFolderUnlocked(folderName)) {
    onSuccess?.();
    return;
  }
  openFolderUnlockDialog(folderName, {
    onSuccess: () => {
      onSuccess?.();
      renderLibrary();
    },
    onCancel: () => {},
  });
}

function handleFolderRelock(folderName) {
  lockFolderSession(folderName);
  const browser = getFileBrowserState();
  if (browser?.category === folderName) {
    setFileBrowserState({ category: null, group: null });
  }
  renderLibrary();
}

setupDropZone();
initImagePreview();
initFileBrowser(fileBrowserRoot, {
  onDelete: openDeleteDialog,
  onDownload: handleDownload,
  onRename: openRenameDialog,
  onLock: openLockDialog,
  onUnlock: handleUnlockButton,
  onOcr: openOcrDialog,
  onFolderRename: openFolderRenameDialog,
  onFolderCreate: openFolderCreateDialog,
  onFolderDelete: handleFolderDelete,
  onFolderLock: openFolderLockDialog,
  onFolderUnlock: handleFolderUnlock,
  onFolderRelock: handleFolderRelock,
  isDocUnlocked,
  isFolderUnlocked,
  onDocumentMove: moveDocumentToCategory,
  onExternalDrop: ingestExternalFilesToCategory,
  onSyncGitHubMega: handleSyncGitHubMega,
});
applySearchOptionsToForm(loadSearchOptions());
initTheme();
initPasswordToggles(document);

themeToggleBtn?.addEventListener("click", () => toggleTheme());
advancedSearchPanel?.querySelectorAll("input").forEach((input) => {
  input.addEventListener("change", () => {
    saveSearchOptions(readSearchOptionsFromForm());
    if (searchQuery.value.trim()) runSearch();
  });
});

ocrExtractBtn?.addEventListener("click", () => confirmOcrExtract());
ocrCancelBtn?.addEventListener("click", closeOcrDialog);
ocrDialogBackdrop?.addEventListener("click", closeOcrDialog);

document.getElementById("ocr-engine")?.addEventListener("change", () => {
  saveOcrOptions({ engine: readOcrEngineFromForm() });
  updateOcrEnginePanel();
});

puterConnectBtn?.addEventListener("click", () => {
  handlePuterConnect();
});

puterDisconnectBtn?.addEventListener("click", () => {
  handlePuterDisconnect();
});

export async function startApp({ user, auth }) {
  currentUser = user;
  authApi = auth;
  sessionPassword = getVaultPassword();
  setStorageUserId(user.id);

  adminMembersApi = initAdminMembers({
    getActor: () => currentUser,
    onStatus: setStatus,
    isAdmin: () => authApi?.isAdmin?.(),
  });

  try {
    setStatus("جارٍ الاتصال بـ MEGA…");
    await ensureMegaAutoLogin();
    await hydrateDocuments(sessionPassword);
    applySearchOptionsToForm(loadSearchOptions());
    updateOcrEnginePanel();
    updateUploadAccess();
    showView();
  } catch (error) {
    setStatus(`تعذّر تحميل المستندات: ${error.message}`, true);
    showView();
  }
}
