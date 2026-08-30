const THEME_KEY = "docshelf_theme";

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};

export function getStoredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
}

export function setTheme(theme) {
  const next = theme === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT;
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  return next;
}

export function applyTheme(theme = getStoredTheme()) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("theme-toggle-btn");
  if (toggle) {
    const isDark = theme === THEMES.DARK;
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.textContent = isDark ? "☀️ الوضع الفاتح" : "🌙 الوضع الداكن";
  }
}

export function toggleTheme() {
  const next = getStoredTheme() === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
  return setTheme(next);
}

export function initTheme() {
  applyTheme(getStoredTheme());
}
