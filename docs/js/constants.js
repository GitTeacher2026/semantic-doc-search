export const EXT_GROUPS = {
  pdf: [".pdf"],
  word: [".doc", ".docx"],
  excel: [".xls", ".xlsx"],
  powerpoint: [".ppt", ".pptx"],
  text: [".txt", ".md", ".text", ".log", ".csv"],
};

export const GROUP_LABELS = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  text: "نص",
  other: "أخرى",
};

export const GROUP_ICONS = {
  pdf: "📄",
  word: "📝",
  excel: "📊",
  powerpoint: "📽️",
  text: "📃",
  other: "📁",
};

export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".text",
  ".log",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

export function fileExtension(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function fileGroup(filename) {
  const ext = `.${fileExtension(filename)}`;
  for (const [group, extensions] of Object.entries(EXT_GROUPS)) {
    if (extensions.includes(ext)) return group;
  }
  return "other";
}

export function fileEndsWith(filename, extension) {
  return fileExtension(filename) === extension.replace(/^\./, "").toLowerCase();
}

export function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}
