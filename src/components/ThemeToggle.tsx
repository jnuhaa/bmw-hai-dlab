import { useCallback, useEffect, useState } from "react";
import { applyTheme, getThemeFromDocument, type Theme } from "../theme";

function SunGlyph() {
  return (
    <svg
      className="theme-toggle__sun-svg"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type ThemeToggleProps = {
  /** Inline in footer card vs fixed corner (Phone route). */
  variant?: "floating" | "embedded";
};

export function ThemeToggle({ variant = "floating" }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => getThemeFromDocument());

  useEffect(() => {
    const onStorage = () => setTheme(getThemeFromDocument());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className={`theme-toggle theme-toggle--${variant}`}
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-toggle__icon" aria-hidden>
        <SunGlyph />
      </span>
    </button>
  );
}
