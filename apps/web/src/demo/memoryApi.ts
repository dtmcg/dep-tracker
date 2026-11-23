import {
  applyCommands,
  type Command,
  type ExternalTime,
  newId,
  type Project,
  schedule,
  storageKey,
  type StorageDescriptor,
} from "@dep-tracker/domain";
import { type Api, ApiError, type NewProject, type OpenedProject } from "../api.ts";
import type { Example } from "./examples.ts";

const unavailable = (what: string) => new ApiError(`${what} isn't available in the online demo; run dep-tracker locally for that.`, 400);
const RESOURCE_COMMANDS = ["addResourceType", "removeResourceType", "addResource", "removeResource"];

interface Entry {
  project: Project;
  path: string;
  version: number;
}

/** The API plus what only the demo needs: switching example and starting a blank project. */
export interface MemoryBackend extends Api {
  /** Replace everything with the example (and any projects its references point at). */
  loadExample: (id: string) => OpenedProject;
  /** Replace everything with a new project that holds just its success criteria node. */
  startNew: (name: string, successCriteria: string) => OpenedProject;
  /** Put the current example (or blank project) back as it was. */
  reset: () => OpenedProject;
}

/**
 * The API, with projects kept in memory instead of behind a server: the same commands, validation, reference
 * resolution and scheduling as the real backend, nothing saved. Reloading the page starts again.
 */
export function createMemoryBackend(examples: Example[], options: { resourcing?: boolean } = {}): MemoryBackend {
  let entries = new Map<string, Entry>(); // by project id
  let current: { example: string } | { blank: { name: string; successCriteria: string } } = { example: examples[0]!.id };
  let main = "";
  let counter = 0;

  const byPath = (path: string) => [...entries.values()].find((e) => storageKey({ kind: "csv", path }) === storageKey({ kind: "csv", path: e.path }));
  const get = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw new ApiError("That project isn't part of the demo", 404);
    return entry;
  };
  const place = (project: Project, path: string): Entry => {
    const entry = { project, path, version: ++counter };
    entries.set(project.id, entry);
    return entry;
  };

  /** Completion of each reference node, and a token that changes when any project referenced (directly or not) does. */
  function resolve(project: Project, self: Entry, stack: string[], seen: string[]): Record<string, ExternalTime> {
    const externals: Record<string, ExternalTime> = {};
    for (const node of project.nodes) {
      if (!node.ref) continue;
      const target = byPath(node.ref.storage.path);
      if (!target) {
        externals[node.id] = { error: `The project "${node.ref.storage.path}" isn't part of the demo` };
        continue;
      }
      seen.push(`${target.project.id}@${target.version}`);
      if (stack.includes(target.project.id)) {
        externals[node.id] = { error: "cycle", cycle: [...stack.slice(stack.indexOf(target.project.id)).map((id) => entries.get(id)!.project.name), target.project.name] };
        continue;
      }
      const inner = resolve(target.project, target, [...stack, target.project.id], seen);
      const result = schedule(target.project, inner);
      const root = result.nodes[target.project.rootId];
      externals[node.id] = root
        ? { completion: root.completion }
        : { error: result.errors[target.project.rootId] ?? `"${target.project.name}" has no completion date` };
    }
    return externals;
  }

  const snapshot = (entry: Entry): OpenedProject => {
    const seen: string[] = [];
    const externals = resolve(entry.project, entry, [entry.project.id], seen);
    return {
      project: structuredClone(entry.project),
      version: String(entry.version),
      storage: { kind: "csv", path: entry.path },
      externals,
      referencesVersion: [...new Set(seen)].sort().join(","),
      schedule: schedule(entry.project, externals),
    };
  };

  function blankProject(name: string, successCriteria: string): Project {
    const rootId = newId();
    return applyCommands(
      { id: newId().replace(/^n/, "p"), name: name.trim(), start: new Date().toISOString(), rootId, nodes: [], edges: [] },
      [{ type: "addNode", node: { id: rootId, title: successCriteria, workTime: "", labels: [], description: "", links: [] } }],
    );
  }

  function install() {
    entries = new Map();
    if ("example" in current) {
      const example = examples.find((e) => e.id === current.example);
      if (!example) throw new ApiError(`There is no example called "${current.example}"`, 404);
      const built = example.build();
      main = place(built.main, `demo/${example.id}`).project.id;
      for (const [path, other] of Object.entries(built.others ?? {})) place(other, path);
    } else {
      main = place(blankProject(current.blank.name, current.blank.successCriteria), "demo/new").project.id;
    }
    return snapshot(get(main));
  }
  install();

  return {
    loadExample(id) {
      current = { example: id };
      return install();
    },
    startNew(name, successCriteria) {
      if (!name.trim()) throw new ApiError("A project needs a name", 422);
      current = { blank: { name, successCriteria } };
      return install();
    },
    reset: () => install(),

    library: async () => [],
    forgetProject: async () => ({ ok: true }),
    config: async () => ({ projectsDir: "", resourcing: options.resourcing === true }),
    openProject: async (storage: StorageDescriptor) => {
      const found = byPath(storage.path);
      if (!found) throw new ApiError(`The project "${storage.path}" isn't part of the demo`, 404);
      return snapshot(found);
    },
    getProject: async (id: string) => snapshot(get(id)),
    version: async (id: string) => {
      const { referencesVersion } = snapshot(get(id));
      return { version: String(get(id).version), referencesVersion };
    },
    sendCommands: async (id: string, expectedVersion: string, commands: Command[]) => {
      const entry = get(id);
      if (expectedVersion !== String(entry.version)) throw new ApiError("The project changed, reload it", 409);
      if (!options.resourcing && commands.some((c) => RESOURCE_COMMANDS.includes(c.type))) throw new ApiError("Resourcing is not enabled", 403);
      try {
        entry.project = applyCommands(entry.project, commands);
      } catch (error) {
        throw new ApiError((error as Error).message, 422);
      }
      entry.version = ++counter;
      return snapshot(entry);
    },
    createProject: async (input: NewProject) => {
      if (!input.name.trim()) throw new ApiError("A project needs a name", 422);
      return startFromInput(input);
    },
    importProject: async () => {
      throw unavailable("Importing");
    },
    exportProject: async () => {
      throw unavailable("Exporting");
    },
  } as MemoryBackend;

  function startFromInput(input: NewProject): OpenedProject {
    current = { blank: { name: input.name, successCriteria: input.root.title } };
    return install();
  }
}
