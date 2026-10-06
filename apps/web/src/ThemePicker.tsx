import { useState } from "react";
import { applyTheme, loadTheme, resolveTheme, saveTheme, THEMES } from "./themes.ts";

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

/** Applies the saved (or system) style; call before the first render to avoid a flash. */
export function applyInitialTheme(): string {
  const id = resolveTheme(loadTheme(window.localStorage), prefersDark());
  applyTheme(id);
  return id;
}

/** Style switcher (FR-22). The choice is remembered in this browser. */
export function ThemePicker() {
  const [id, setId] = useState(() => document.documentElement.dataset.theme ?? resolveTheme(null, prefersDark()));
  return (
    <label className="theme-picker">
      <span>Style</span>
      <select
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          applyTheme(e.target.value);
          saveTheme(window.localStorage, e.target.value);
        }}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
