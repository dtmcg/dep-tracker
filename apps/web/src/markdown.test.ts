import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    const html = renderMarkdown("**Ship** it\n\n- one\n- two");
    assert.match(html, /<strong>Ship<\/strong>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
    assert.doesNotMatch(html, /<img|<script/);
    assert.match(html, /&lt;script&gt;/);
  });

  it("drops links with unsafe protocols but keeps the text", () => {
    const html = renderMarkdown("[click](javascript:alert(1)) and [ok](https://example.com)");
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /click/);
    assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  });
});
