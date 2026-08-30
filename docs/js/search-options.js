const SEARCH_OPTIONS_KEY = "docshelf_search_options";

export const DEFAULT_SEARCH_OPTIONS = {
  matchCase: false,
  wholeWords: false,
  exactPhrase: false,
  searchInFilename: true,
  searchInContent: true,
};

export function loadSearchOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(SEARCH_OPTIONS_KEY) || "{}");
    return { ...DEFAULT_SEARCH_OPTIONS, ...saved };
  } catch {
    return { ...DEFAULT_SEARCH_OPTIONS };
  }
}

export function saveSearchOptions(options) {
  localStorage.setItem(
    SEARCH_OPTIONS_KEY,
    JSON.stringify({ ...DEFAULT_SEARCH_OPTIONS, ...options })
  );
}

export function readSearchOptionsFromForm(root = document) {
  return {
    matchCase: Boolean(root.querySelector("#search-opt-match-case")?.checked),
    wholeWords: Boolean(root.querySelector("#search-opt-whole-words")?.checked),
    exactPhrase: Boolean(root.querySelector("#search-opt-exact-phrase")?.checked),
    searchInFilename: Boolean(root.querySelector("#search-opt-filename")?.checked),
    searchInContent: root.querySelector("#search-opt-content")?.checked !== false,
  };
}

export function applySearchOptionsToForm(options, root = document) {
  const set = (id, value) => {
    const el = root.querySelector(id);
    if (el) el.checked = Boolean(value);
  };
  set("#search-opt-match-case", options.matchCase);
  set("#search-opt-whole-words", options.wholeWords);
  set("#search-opt-exact-phrase", options.exactPhrase);
  set("#search-opt-filename", options.searchInFilename);
  set("#search-opt-content", options.searchInContent);
}
