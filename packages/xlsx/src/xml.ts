/** Just enough XML for SpreadsheetML: attributes, text and entity handling via regular expressions. */

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 cannot carry
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

/** Attributes of a start tag's attribute text, keyed by local name (prefixes dropped). */
export function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = m[1]!.includes(":") && !m[1]!.startsWith("xmlns") ? m[1]!.split(":").pop()! : m[1]!;
    out[name] = decodeXml(m[2] ?? m[3] ?? "");
  }
  return out;
}

/** Every element with this local name: its attributes and inner XML ("" when self-closing). */
export function elements(xml: string, name: string): { attrs: Record<string, string>; inner: string }[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>)`, "g");
  return [...xml.matchAll(re)].map((m) => ({ attrs: attributes(m[1] ?? ""), inner: m[2] ?? "" }));
}

/** Concatenated text of every <t> in a string item, ignoring phonetic runs. */
export function textContent(inner: string): string {
  const withoutPhonetics = inner.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, "");
  return elements(withoutPhonetics, "t")
    .map((t) => decodeXml(t.inner))
    .join("");
}
