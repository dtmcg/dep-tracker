import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type StorageDescriptor, storageKey } from "@dep-tracker/domain";

export interface KnownProject {
  name: string;
  storage: StorageDescriptor;
  /** ISO time the project was last created, opened or imported here. */
  lastOpened: string;
}

/**
 * The app's own list of projects it has created, opened or imported, kept in a small JSON file next
 * to the code. People never need to touch it; it only feeds the "Open project" list. Failing to read
 * or write it never gets in the way of the real work.
 */
export interface Library {
  list(): Promise<KnownProject[]>;
  record(storage: StorageDescriptor, name: string): Promise<void>;
  forget(storage: StorageDescriptor): Promise<void>;
}

export function createLibrary(file: string, now: () => Date = () => new Date()): Library {
  const keyOf = (s: StorageDescriptor) => storageKey(s);

  async function read(): Promise<KnownProject[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { projects?: unknown };
      if (!Array.isArray(parsed.projects)) return [];
      return parsed.projects.filter(
        (p): p is KnownProject =>
          !!p && typeof p.name === "string" && typeof p.lastOpened === "string" && typeof p.storage?.kind === "string" && typeof p.storage?.path === "string",
      );
    } catch {
      return [];
    }
  }

  async function write(projects: KnownProject[]): Promise<void> {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ projects }, null, 2) + "\n", "utf8");
      await rename(temp, file);
    } catch {
      // The list is a convenience; losing a write must not break opening or saving a project.
    }
  }

  // Calls are serialised so two quick requests can't overwrite each other's change.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    list: () =>
      exclusive(async () => (await read()).sort((a, b) => (a.lastOpened < b.lastOpened ? 1 : a.lastOpened > b.lastOpened ? -1 : 0))),

    record: (storage, name) =>
      exclusive(async () => {
        const key = keyOf(storage);
        const others = (await read()).filter((p) => keyOf(p.storage) !== key);
        await write([...others, { name, storage, lastOpened: now().toISOString() }]);
      }),

    forget: (storage) =>
      exclusive(async () => {
        const key = keyOf(storage);
        await write((await read()).filter((p) => keyOf(p.storage) !== key));
      }),
  };
}
