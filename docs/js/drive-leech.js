import { ensureDriveAccess, isDriveConnected, loginToGoogleDrive } from "./drive-auth.js";
import { downloadDriveFile, getDriveFileMeta, listDriveFolderFiles } from "./drive-storage.js";
import { isMegaConnected } from "./mega-auth.js";
import { uploadDocumentFile as uploadMegaDocumentFile } from "./mega-storage.js";
import {
  driveDownloadUrl,
  extractDriveFileId,
  getConfiguredPharmaFolderId,
  mergeDriveFolderIntoCatalog,
} from "./pharmacopoeia.js";

const PHARMA_CATEGORY = "دساتير الأدوية";

async function ensureDriveReady() {
  if (!isDriveConnected()) {
    await loginToGoogleDrive();
  }
  await ensureDriveAccess();
}

async function downloadViaPublicLink(fileId) {
  const url = driveDownloadUrl(fileId);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`تعذّر تنزيل الملف العام من Drive (${response.status}).`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error("الملف غير متاح للتحميل العام — سجّل دخول Google Drive أو اجعل الرابط «أي شخص لديه الرابط».");
  }
  return response.arrayBuffer();
}

export async function downloadDriveBytesForLeech(driveFileIdOrUrl) {
  const fileId = extractDriveFileId(driveFileIdOrUrl) || String(driveFileIdOrUrl || "").trim();
  if (!fileId) throw new Error("معرّف Google Drive غير صالح.");

  if (isDriveConnected()) {
    try {
      await ensureDriveAccess();
      return await downloadDriveFile(fileId);
    } catch {
      /* fall through to public link */
    }
  }

  try {
    return await downloadViaPublicLink(fileId);
  } catch (publicError) {
    await ensureDriveReady();
    try {
      return await downloadDriveFile(fileId);
    } catch {
      throw publicError;
    }
  }
}

export async function leechDriveFileToMega({
  driveFileId,
  driveUrl,
  filename,
  category = PHARMA_CATEGORY,
  onStatus,
} = {}) {
  if (!isMegaConnected()) {
    throw new Error("اتصل بـ MEGA أولاً قبل السحب (Leech).");
  }

  const fileId = extractDriveFileId(driveFileId || driveUrl);
  if (!fileId) throw new Error("لا يوجد معرّف Drive لهذا الـ monograph.");

  onStatus?.("جارٍ تنزيل الملف من Google Drive…");
  const buffer = await downloadDriveBytesForLeech(fileId);
  const safeName = String(filename || `monograph-${fileId}.pdf`).replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([buffer], { type: "application/pdf" });

  onStatus?.("جارٍ الرفع إلى MEGA…");
  const megaFileId = await uploadMegaDocumentFile(category, safeName, blob);

  return {
    filename: safeName,
    category,
    megaFileId,
    driveFileId: fileId,
    blob,
    bytes: new Uint8Array(buffer),
  };
}

export async function syncPharmacopoeiaFolderFromDrive(folderId = getConfiguredPharmaFolderId()) {
  const id = String(folderId || "").trim();
  if (!id) {
    throw new Error(
      "أضف معرّف مجلد Google Drive في الإعدادات (PHARMACOPOEIA_DRIVE_FOLDER_ID) أو في فهرس monographs."
    );
  }
  await ensureDriveReady();
  const files = await listDriveFolderFiles(id);
  if (!files.length) {
    throw new Error("المجلد فارغ أو لا يمكن قراءته بالحساب الحالي.");
  }
  return mergeDriveFolderIntoCatalog(files, { folderId: id });
}

export async function resolveDriveFilename(driveFileId, fallback = "monograph.pdf") {
  try {
    await ensureDriveReady();
    const meta = await getDriveFileMeta(driveFileId);
    return meta?.name || fallback;
  } catch {
    return fallback;
  }
}

export { PHARMA_CATEGORY };
