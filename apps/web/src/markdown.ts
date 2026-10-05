import { Marked, type Tokens } from "marked";

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SAFE_URL = /^(https?:|mailto:|#|\/)/i;

/** Markdown for node descriptions: raw HTML is shown as text and only safe link protocols render (FR-7). */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_URL.test(href.trim())) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ text }: Tokens.Image) {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}
