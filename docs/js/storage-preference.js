import { isDriveConfigured } from "./drive-auth.js";
import { isOneDriveConfigured } from "./onedrive-auth.js";

const STORAGE_PREF_KEY = "docshelf_storage_mode_v2";

export const STORAGE_MODES = {
  GITHUB: "github",
  DRIVE: "drive",
  MEGA: "mega",
  ONEDRIVE: "onedrive",
  LOCAL: "local",
};

export function isDriveModeAvailable() {
  return isDriveConfigured();
}

export function isMegaModeAvailable() {
  return true;
}

export function isOneDriveModeAvailable() {
  return isOneDriveConfigured();
}

export function getAvailableStorageModes() {
  return [
    {
      id: STORAGE_MODES.DRIVE,
      label: "Google Drive",
      hint: "ملفات وفهرس في مجلد Drive — يتطلب تسجيل الدخول",
      available: isDriveModeAvailable(),
    },
    {
      id: STORAGE_MODES.MEGA,
      label: "MEGA",
      hint: "تخزين في حساب MEGA — بريد وكلمة مرور",
      available: isMegaModeAvailable(),
    },
    {
      id: STORAGE_MODES.ONEDRIVE,
      label: "OneDrive",
      hint: "ملفات وفهرس في OneDrive — يتطلب تسجيل الدخول",
      available: isOneDriveModeAvailable(),
    },
    {
      id: STORAGE_MODES.LOCAL,
      label: "محلي",
      hint: "متصفح فقط — بدون مزامنة سحابية",
      available: true,
    },
  ].filter((item) => item.available);
}

export function hasStorageChoice() {
  return getAvailableStorageModes().length > 1;
}

export function getDefaultStorageMode() {
  const modes = getAvailableStorageModes();
  const preferred = [
    STORAGE_MODES.MEGA,
    STORAGE_MODES.DRIVE,
    STORAGE_MODES.ONEDRIVE,
    STORAGE_MODES.LOCAL,
  ];
  for (const mode of preferred) {
    if (modes.some((item) => item.id === mode)) return mode;
  }
  return STORAGE_MODES.LOCAL;
}

export function getResolvedStorageMode() {
  if (isMegaModeAvailable()) return STORAGE_MODES.MEGA;
  return STORAGE_MODES.LOCAL;
}

export function getStorageMode() {
  return getResolvedStorageMode();
}

export function setStorageMode(mode) {
  const allowed = new Set(getAvailableStorageModes().map((item) => item.id));
  if (!allowed.has(mode)) {
    throw new Error("وضع التخزين غير متاح.");
  }
  localStorage.setItem(STORAGE_PREF_KEY, mode);
}

export function getStorageModeLabel(mode = getResolvedStorageMode()) {
  const match = getAvailableStorageModes().find((item) => item.id === mode);
  return match?.label || mode;
}

export function getStorageModeHint(mode = getResolvedStorageMode()) {
  const match = getAvailableStorageModes().find((item) => item.id === mode);
  return match?.hint || "";
}
