export function normalizeFolders(folders) {
  if (!Array.isArray(folders)) return [];
  const seen = new Set();
  const normalized = [];
  for (const entry of folders) {
    const name = String(entry?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({
      name,
      isLocked: Boolean(entry?.isLocked),
      lockHash: entry?.lockHash || null,
    });
  }
  return normalized.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function syncFoldersFromDocuments(documents, folders = []) {
  const map = new Map(normalizeFolders(folders).map((folder) => [folder.name, { ...folder }]));
  for (const doc of documents || []) {
    const name = String(doc?.category || "").trim();
    if (!name) continue;
    if (!map.has(name)) {
      map.set(name, { name, isLocked: false, lockHash: null });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function getFolderByName(folders, name) {
  const target = String(name || "").trim();
  return (folders || []).find((folder) => folder.name === target) || null;
}

export function listFolderNames(folders, documents = []) {
  const names = new Set();
  for (const folder of folders || []) {
    if (folder?.name) names.add(folder.name);
  }
  for (const doc of documents || []) {
    if (doc?.category) names.add(doc.category);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "ar"));
}

export function ensureFolderRecord(folders, name) {
  const folderName = String(name || "").trim();
  if (!folderName) return folders;
  if (getFolderByName(folders, folderName)) return folders;
  return [...folders, { name: folderName, isLocked: false, lockHash: null }].sort((a, b) =>
    a.name.localeCompare(b.name, "ar")
  );
}

export function renameFolderInState(state, oldName, newName) {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to || from === to) return state;
  if (getFolderByName(state.folders, to)) {
    throw new Error(`المجلد «${to}» موجود بالفعل.`);
  }

  const folders = (state.folders || []).map((folder) =>
    folder.name === from ? { ...folder, name: to } : folder
  );
  const documents = (state.documents || []).map((doc) =>
    (doc.category || "عام") === from ? { ...doc, category: to } : doc
  );
  const trash = (state.trash || []).map((doc) =>
    (doc.category || "عام") === from ? { ...doc, category: to } : doc
  );

  return { ...state, folders, documents, trash };
}

export function deleteFolderFromState(state, folderName) {
  const name = String(folderName || "").trim();
  const docs = (state.documents || []).filter((doc) => (doc.category || "عام") === name);
  const remainingDocs = (state.documents || []).filter((doc) => (doc.category || "عام") !== name);
  const trash = [
    ...docs.map((doc) => ({ ...doc, deletedAt: new Date().toISOString() })),
    ...(state.trash || []),
  ];
  const folders = (state.folders || []).filter((folder) => folder.name !== name);
  return { ...state, folders, documents: remainingDocs, trash };
}

export function setFolderLock(state, folderName, lockHash) {
  const name = String(folderName || "").trim();
  const folders = ensureFolderRecord(state.folders || [], name).map((folder) =>
    folder.name === name ? { ...folder, isLocked: true, lockHash } : folder
  );
  return { ...state, folders };
}

export function clearFolderLock(state, folderName) {
  const name = String(folderName || "").trim();
  const folders = (state.folders || []).map((folder) =>
    folder.name === name ? { ...folder, isLocked: false, lockHash: null } : folder
  );
  return { ...state, folders };
}

export function countDocumentsInFolder(documents, folderName) {
  const name = String(folderName || "").trim();
  return (documents || []).filter((doc) => (doc.category || "عام") === name).length;
}
