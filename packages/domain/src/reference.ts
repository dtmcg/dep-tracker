import type { StorageDescriptor } from "./model.ts";

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}

export const STORAGE_KINDS = ["csv", "excel", "obsidian", "gsheets"] as const;

/** A reference target as one cell or frontmatter value: "kind:path", e.g. "csv:C:\plans\partner". */
export function formatReference(storage: StorageDescriptor): string {
  return `${storage.kind}:${storage.path}`;
}

/** Inverse of formatReference. Splits at the first colon, so Windows drive letters survive. */
export function parseReference(text: string): StorageDescriptor {
  const trimmed = text.trim();
  const at = trimmed.indexOf(":");
  const kind = at > 0 ? trimmed.slice(0, at).trim().toLowerCase() : "";
  const path = at > 0 ? trimmed.slice(at + 1).trim() : "";
  if (!(STORAGE_KINDS as readonly string[]).includes(kind) || !path) {
    throw new ReferenceError(
      `"${trimmed}" is not a project reference; write it as kind:path where kind is one of ${STORAGE_KINDS.join(", ")} (for example csv:C:\\plans\\partner)`,
    );
  }
  return { kind, path } as StorageDescriptor;
}

/**
 * Identity of a store, so the same project reached by two spellings of its
 * path counts once (used to spot loops of references between projects).
 */
export function storageKey(storage: StorageDescriptor): string {
  if (storage.kind === "gsheets") return `gsheets:${storage.path.trim()}`;
  const normal = storage.path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/(^|\/)\.(?=\/|$)/g, "$1")
    .replace(/\/+/g, "/")
    .replace(/(.)\/$/, "$1")
    .toLowerCase();
  return `${storage.kind}:${normal}`;
}
