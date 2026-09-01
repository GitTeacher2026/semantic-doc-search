import { isMegaConnected, isMegaConfigured } from "./mega-auth.js";
import { STORAGE_MODES } from "./storage-preference.js";

const STORAGE_KEY = "docshelf_upload_dest_v1";

const DESTINATION_HINTS = {
  [STORAGE_MODES.MEGA]: "الملفات تُرفع إلى مجلدك الخاص في MEGA.",
};

export function getUploadDestinationOptions() {
  if (isMegaConnected() || isMegaConfigured()) {
    return [{ id: STORAGE_MODES.MEGA, label: "MEGA" }];
  }
  return [];
}

export function hasUploadDestinationChoice() {
  return getUploadDestinationOptions().length > 1;
}

export function getUploadDestination() {
  const options = getUploadDestinationOptions();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && options.some((item) => item.id === saved)) return saved;
  return options[0]?.id || STORAGE_MODES.MEGA;
}

export function setUploadDestination(mode) {
  const options = getUploadDestinationOptions();
  if (!options.some((item) => item.id === mode)) {
    throw new Error("وجهة الرفع غير متاحة.");
  }
  localStorage.setItem(STORAGE_KEY, mode);
}

export function getUploadDestinationLabel(mode = getUploadDestination()) {
  return getUploadDestinationOptions().find((item) => item.id === mode)?.label || mode;
}

export function getUploadDestinationHint(mode = getUploadDestination()) {
  return DESTINATION_HINTS[mode] || "";
}

export function isUploadDestinationReady(mode = getUploadDestination()) {
  if (mode === STORAGE_MODES.MEGA) return isMegaConnected();
  return false;
}
