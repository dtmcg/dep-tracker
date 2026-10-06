/** UI styles (FR-22): each is a full set of design tokens, applied as CSS custom properties. */
export const TOKEN_NAMES = [
  "bg",
  "surface",
  "surfaceSunk",
  "ink",
  "inkQuiet",
  "line",
  "accent",
  "accentInk",
  "accentSoft",
  "danger",
  "dangerBg",
  "warn",
  "noticeBg",
  "noticeInk",
  "upstream",
  "downstream",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

export interface Theme {
  id: string;
  name: string;
  scheme: "light" | "dark";
  tokens: Record<TokenName, string>;
  /** Overrides for non-colour tokens (shape and type). */
  shape?: { radius?: string; font?: string };
}

export const THEMES: Theme[] = [
  {
    id: "light",
    name: "Light",
    scheme: "light",
    tokens: {
      bg: "#f6f5f1",
      surface: "#ffffff",
      surfaceSunk: "#f0efea",
      ink: "#1d1d1b",
      inkQuiet: "#5f5e58",
      line: "#dddbd3",
      accent: "#2f5bd3",
      accentInk: "#ffffff",
      accentSoft: "#e6ecfb",
      danger: "#b3261e",
      dangerBg: "#fbeceb",
      warn: "#8a5a00",
      noticeBg: "#eef3e6",
      noticeInk: "#3c5a14",
      upstream: "#b85c00",
      downstream: "#0b7f73",
    },
  },
  {
    id: "dark",
    name: "Dark",
    scheme: "dark",
    tokens: {
      bg: "#151514",
      surface: "#1f1f1d",
      surfaceSunk: "#181817",
      ink: "#ecebe6",
      inkQuiet: "#a3a29b",
      line: "#34332f",
      accent: "#7c9bff",
      accentInk: "#0d1330",
      accentSoft: "#1f2a4a",
      danger: "#ff8a80",
      dangerBg: "#3a1d1b",
      warn: "#f0c060",
      noticeBg: "#1f2a14",
      noticeInk: "#c5e09a",
      upstream: "#f0a24a",
      downstream: "#3fc7b5",
    },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    scheme: "light",
    tokens: {
      bg: "#ffffff",
      surface: "#ffffff",
      surfaceSunk: "#ececec",
      ink: "#000000",
      inkQuiet: "#2b2b2b",
      line: "#000000",
      accent: "#0033cc",
      accentInk: "#ffffff",
      accentSoft: "#d9e2ff",
      danger: "#a30000",
      dangerBg: "#ffe3e3",
      warn: "#6b3f00",
      noticeBg: "#e1f2d0",
      noticeInk: "#0f3300",
      upstream: "#8a3c00",
      downstream: "#005a50",
    },
    shape: { radius: "4px" },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    scheme: "dark",
    tokens: {
      bg: "#0b2a4a",
      surface: "#103559",
      surfaceSunk: "#0a2440",
      ink: "#e8f1fb",
      inkQuiet: "#a9c4e0",
      line: "#2f5f8f",
      accent: "#7fd1ff",
      accentInk: "#06223d",
      accentSoft: "#18476f",
      danger: "#ffb3a7",
      dangerBg: "#4a2430",
      warn: "#ffd27a",
      noticeBg: "#16424d",
      noticeInk: "#bdf0d0",
      upstream: "#ffb86b",
      downstream: "#6ff0d0",
    },
    shape: { radius: "2px", font: '"IBM Plex Mono", ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace' },
  },
];

export const DEFAULT_THEME = "light";
const STORAGE_KEY = "dep-tracker.theme";

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The style the person picked, or null if they haven't (storage may be blocked). */
export function loadTheme(storage: ThemeStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveTheme(storage: ThemeStorage, id: string): void {
  try {
    storage.setItem(STORAGE_KEY, id);
  } catch {
    // The choice just won't outlast this tab.
  }
}

/** Which style to show: the saved choice, else Light/Dark to match the operating system. */
export function resolveTheme(saved: string | null, systemPrefersDark: boolean): string {
  if (saved === null) return systemPrefersDark ? "dark" : "light";
  return THEMES.some((t) => t.id === saved) ? saved : DEFAULT_THEME;
}

const cssName = (token: TokenName) => `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Sets the style's tokens on the page and records its id for CSS and tests. */
export function applyTheme(id: string, root: HTMLElement = document.documentElement): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  for (const token of TOKEN_NAMES) root.style.setProperty(cssName(token), theme.tokens[token]);
  root.style.setProperty("--radius", theme.shape?.radius ?? "10px");
  if (theme.shape?.font) root.style.setProperty("--font", theme.shape.font);
  else root.style.removeProperty("--font");
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
}
