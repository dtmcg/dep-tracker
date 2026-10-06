import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, DEFAULT_THEME, loadTheme, resolveTheme, saveTheme, THEMES, TOKEN_NAMES, type ThemeStorage } from "./themes.ts";

function memory(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
    assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(2), "1.00");
    assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  });
});

describe("the four styles", () => {
  it("offers Light, Dark, High contrast and Blueprint", () => {
    assert.deepEqual(THEMES.map((t) => t.name), ["Light", "Dark", "High contrast", "Blueprint"]);
  });

  for (const theme of THEMES) {
    describe(theme.name, () => {
      it("defines every design token", () => {
        assert.deepEqual(Object.keys(theme.tokens).sort(), [...TOKEN_NAMES].sort());
      });

      const pairs: [string, keyof typeof theme.tokens, keyof typeof theme.tokens, number][] = [
        ["text on the page", "ink", "bg", 4.5],
        ["text on panels", "ink", "surface", 4.5],
        ["quiet text on the page", "inkQuiet", "bg", 4.5],
        ["quiet text on panels", "inkQuiet", "surface", 4.5],
        ["button text", "accentInk", "accent", 4.5],
        ["accent on panels", "accent", "surface", 3],
        ["errors on panels", "danger", "surface", 4.5],
        ["errors on their background", "danger", "dangerBg", 4.5],
        ["warnings on panels", "warn", "surface", 4.5],
        ["notices", "noticeInk", "noticeBg", 4.5],
        ["upstream highlight on the page", "upstream", "bg", 3],
        ["downstream highlight on the page", "downstream", "bg", 3],
        ["borders on the page", "line", "bg", 1.15],
      ];
      for (const [what, fg, bg, min] of pairs) {
        it(`keeps ${what} legible (≥ ${min}:1)`, () => {
          const ratio = contrastRatio(theme.tokens[fg], theme.tokens[bg]);
          assert.ok(ratio >= min, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
        });
      }
    });
  }

  it("makes High contrast at least AAA for text", () => {
    const hc = THEMES.find((t) => t.id === "high-contrast")!;
    assert.ok(contrastRatio(hc.tokens.ink, hc.tokens.bg) >= 7);
    assert.ok(contrastRatio(hc.tokens.inkQuiet, hc.tokens.surface) >= 7);
  });

  it("tells the highlights apart from each other", () => {
    for (const t of THEMES) assert.notEqual(t.tokens.upstream.toLowerCase(), t.tokens.downstream.toLowerCase());
  });
});

describe("choosing a style", () => {
  it("follows the operating system until a style is chosen", () => {
    assert.equal(resolveTheme(null, true), "dark");
    assert.equal(resolveTheme(null, false), "light");
  });

  it("uses the chosen style, ignoring the system", () => {
    assert.equal(resolveTheme("blueprint", false), "blueprint");
    assert.equal(resolveTheme("high-contrast", true), "high-contrast");
  });

  it("ignores a stored style it doesn't know", () => {
    assert.equal(resolveTheme("neon", false), DEFAULT_THEME);
  });

  it("remembers the choice", () => {
    const store = memory();
    assert.equal(loadTheme(store), null);
    saveTheme(store, "blueprint");
    assert.equal(loadTheme(store), "blueprint");
  });

  it("carries on when storage is unavailable", () => {
    const broken: ThemeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(loadTheme(broken), null);
    assert.doesNotThrow(() => saveTheme(broken, "dark"));
  });
});
