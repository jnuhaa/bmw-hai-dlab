export const THEME_STORAGE_KEY = "bmw-ai-lab-theme";

export type Theme = "light" | "dark";

/** Phone capture routes always use dark UI (no theme toggle). */
export function isPhoneCapturePath(): boolean {
  return (
    /^\/phone\/?$/.test(window.location.pathname) ||
    /^\/phone\/[^/]+\/?$/.test(window.location.pathname)
  );
}

/** Sets `data-theme` on `<html>` and persists when the user has chosen a theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/** First paint: use saved preference, otherwise follow `prefers-color-scheme` (no write). Phone capture defaults to dark. */
export function initTheme(): void {
  if (isPhoneCapturePath()) {
    document.documentElement.dataset.theme = "dark";
    return;
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    document.documentElement.dataset.theme = stored;
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
}

export function getThemeFromDocument(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
