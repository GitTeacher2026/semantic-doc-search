import {
  BM25Index,
  assignCategory,
  allChunksFromDocuments,
} from "./bm25-search.js";

const AUTH_KEY = "docshelf_auth";
const STORE_KEY = "docshelf_store_v4";
const USERNAME = "admin";
const PASSWORD = "docshelf2024";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

const EXT_GROUPS = {
  pdf: [".pdf"],
  word: [".doc", ".docx"],
  excel: [".xls", ".xlsx"],
  powerpoint: [".ppt", ".pptx"],
  text: [".txt", ".md", ".text", ".log", ".csv"],
};

const GROUP_LABELS = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  powerpoint: "PowerPoint",
  text: "نص",
  other: "أخرى",
};

const GROUP_ICONS = {
  pdf: "📄",
  word: "📝",
  excel: "📊",
  powerpoint: "📽️",
  text: "📃",
  other: "📁",
};

let pendingFiles = [];
let state = loadState();

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const fileInput = document.getElementById("file-input");
const ingestBtn = document.getElementById("ingest-btn");
const libraryMeta = document.getElementById("library-meta");
const categoryChips = document.getElementById("category-chips");
const libraryList = document.getElementById("library-list");
const categoryFilter = document.getElementById("category-filter");
const searchQuery = document.getElementById("search-query");
const searchBtn = document.getElementById("search-btn");
const searchResults = document.getElementById("search-results");
const resultCount = document.getElementById("result-count");
const resultCountLabel = document.getElementById("result-count-label");
const statusBanner = document.getElementById("status-banner");
const modelStatus = document.getElementById("model-status");

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{"documents":[]}');
  } catch {
    return { documents: [] };
  }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function isAuthed() {
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function showView() {
  if (isAuthed()) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    if (modelStatus) {
      modelStatus.textContent = "البحث فوري — لا حاجة لتحميل نموذج ذكاء اصطناعي";
      modelStatus.classList.add("ready");
    }
    renderLibrary();
  } else {
    appView.classList.add("hidden");
    loginView.classList.remove("hidden");
  }
}

function setStatus(message, show = true) {
  if (!show) {
    statusBanner.classList.add("hidden");
    return;
  }
  statusBanner.textContent = message;
  statusBanner.classList.remove("hidden");
}

function fileExtension(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function fileGroup(filename) {
  const ext = `.${fileExtension(filename)}`;
  for (const [group, extensions] of Object.entries(EXT_GROUPS)) {
    if (extensions.includes(ext)) return group;
  }
  return "other";
}

function fileEndsWith(filename, extension) {
  return fileExtension(filename) === extension.replace(/^\./, "").toLowerCase();
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

async function extractText(file, arrayBuffer) {
  const name = String(file?.name || "");
  const buffer = arrayBuffer || (await file.arrayBuffer());
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

function buildExplorerTree(documents) {
  const categories = new Map();
  for (const doc of documents) {
    const group = doc.fileGroup || fileGroup(doc.filename);
    if (!categories.has(doc.category)) categories.set(doc.category, new Map());
    const groups = categories.get(doc.category);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(doc);
  }
  return [...categories.entries()]
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
    }));
}

function summarizeCategories(documents) {
  const counts = new Map();
  for (const doc of documents) counts.set(doc.category, (counts.get(doc.category) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"));
}

function renderLibrary() {
  const docs = state.documents;
  const docWord = docs.length === 1 ? "مستند" : "مستندات";
  libraryMeta.textContent = `محرك البحث: BM25 (فوري) · ${docs.length} ${docWord}`;

  const categories = summarizeCategories(docs);
  categoryChips.innerHTML = categories
    .map(([name, count]) => `<span class="chip">${name} (${count})</span>`)
    .join("");

  categoryFilter.innerHTML = `<option value="">جميع التصنيفات</option>${categories
    .map(([name]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("")}`;

  if (!docs.length) {
    libraryList.innerHTML = `<p class="muted">لا توجد مستندات بعد. ارفع ملفاً للبدء.</p>`;
    return;
  }

  const tree = buildExplorerTree(docs);
  libraryList.innerHTML = tree
    .map(
      (folder) => `
      <details class="explorer-folder" open>
        <summary>📁 ${escapeHtml(folder.category)} (${folder.count})</summary>
        <div class="explorer-body">
          ${folder.groups
            .map(
              (group) => `
            <div class="explorer-group">
              <div class="explorer-group-title">${group.icon} ${escapeHtml(group.label)} (${group.files.length})</div>
              ${group.files
                .map(
                  (doc) => `
                <article class="explorer-file" data-id="${doc.id}">
                  <div>
                    <div class="explorer-file-title">${GROUP_ICONS[doc.fileGroup] || "📁"} ${escapeHtml(doc.filename)}</div>
                    <div class="explorer-file-meta">${escapeHtml(doc.category)} · ${doc.charCount.toLocaleString("ar-EG")} حرف · ${escapeHtml(doc.extension || "")}</div>
                    <div class="explorer-file-preview">${escapeHtml(doc.preview || "")}${(doc.preview || "").length >= 280 ? "…" : ""}</div>
                  </div>
                  <div class="explorer-actions">
                    <button class="btn ghost small download-btn" data-id="${doc.id}" type="button">تنزيل</button>
                    <button class="btn ghost small delete-btn" data-id="${doc.id}" type="button">حذف</button>
                  </div>
                </article>`
                )
                .join("")}
            </div>`
            )
            .join("")}
        </div>
      </details>`
    )
    .join("");

  libraryList.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.documents = state.documents.filter((d) => d.id !== btn.dataset.id);
      saveState();
      renderLibrary();
    });
  });

  libraryList.querySelectorAll(".download-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const doc = findDocumentById(btn.dataset.id);
      if (doc) downloadDocument(doc);
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function highlightText(text, query) {
  const escaped = escapeHtml(String(text || ""));
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return escaped;
  const tokens = [...new Set(safeQuery.split(/\s+/).filter((token) => token.length >= 2))]
    .sort((a, b) => b.length - a.length);
  let result = escaped;
  for (const token of tokens) {
    const escToken = escapeHtml(token);
    const pattern = new RegExp(escToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    result = result.replace(pattern, '<mark class="query-hit">$&</mark>');
  }
  return result;
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

function downloadDocument(doc) {
  if (!doc.fileData) {
    setStatus("تعذّر التنزيل: الملف غير مخزّن. أعد رفع الملف.", true);
    return;
  }
  const bytes = Uint8Array.from(atob(doc.fileData), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.filename;
  link.click();
  URL.revokeObjectURL(url);
}

function findDocumentById(id) {
  return state.documents.find((doc) => doc.id === id);
}

async function ingestFiles(files) {
  ingestBtn.disabled = true;
  setStatus("جارٍ فهرسة الملفات…");
  try {
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const text = await extractText(file, arrayBuffer);
      if (!text) throw new Error(`لم يُعثر على نص في ${file.name}`);
      const category = assignCategory(text, file.name, state.documents);
      const chunks = chunkText(text).map((content) => ({ content }));
      state.documents.push({
        id: crypto.randomUUID(),
        filename: file.name,
        category,
        fileGroup: fileGroup(file.name),
        extension: fileExtension(file.name),
        charCount: text.length,
        preview: text.replace(/\s+/g, " ").slice(0, 280),
        fileData: arrayBufferToBase64(arrayBuffer),
        chunks,
      });
    }
    saveState();
    renderLibrary();
    setStatus("اكتملت الفهرسة.", true);
    setTimeout(() => setStatus("", false), 2500);
  } catch (error) {
    setStatus(`خطأ: ${error.message}`, true);
  } finally {
    ingestBtn.disabled = !pendingFiles.length;
    pendingFiles = [];
    fileInput.value = "";
  }
}

function runSearch() {
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.innerHTML = `<p class="muted">أدخل عبارة البحث.</p>`;
    return;
  }
  if (!state.documents.length) {
    searchResults.innerHTML = `<p class="muted">ارفع مستندات قبل البحث.</p>`;
    return;
  }

  searchBtn.disabled = true;
  const category = categoryFilter.value || null;
  const k = Number(resultCount.value);
  const index = new BM25Index(allChunksFromDocuments(state.documents));
  const top = index.search(query, k, category);

  if (!top.length) {
    searchResults.innerHTML = `<p class="muted">لم يُعثر على مقاطع مطابقة. جرّب عبارة أوسع.</p>`;
  } else {
    searchResults.innerHTML = top
      .map(
        (hit) => `
        <article class="hit">
          <div class="hit-header">
            <div>
              <strong>${escapeHtml(hit.filename)}</strong>
              <span class="chip">${escapeHtml(hit.category)}</span>
              <span class="score">${Math.round(hit.score * 100)}% تطابق</span>
            </div>
            <button class="btn ghost small search-download-btn" data-id="${escapeHtml(hit.docId)}" type="button">تنزيل</button>
          </div>
          <p>${highlightText(hit.content, query)}</p>
        </article>`
      )
      .join("");

    searchResults.querySelectorAll(".search-download-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const doc = findDocumentById(btn.dataset.id);
        if (doc) downloadDocument(doc);
      });
    });
  }
  searchBtn.disabled = false;
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (username === USERNAME && password === PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, "1");
    loginError.classList.add("hidden");
    showView();
  } else {
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_KEY);
  showView();
});

fileInput.addEventListener("change", () => {
  pendingFiles = [...fileInput.files];
  ingestBtn.disabled = !pendingFiles.length;
});

ingestBtn.addEventListener("click", () => {
  if (pendingFiles.length) ingestFiles(pendingFiles);
});

searchBtn.addEventListener("click", runSearch);
resultCount.addEventListener("input", () => {
  resultCountLabel.textContent = resultCount.value;
});

showView();
