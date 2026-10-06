import { createHash } from "node:crypto";
import { type ExternalTime, type Project, schedule, type StorageAdapter, type StorageDescriptor, storageKey } from "@dep-tracker/domain";

export type AdapterLookup = (descriptor: StorageDescriptor) => StorageAdapter | undefined;

export interface ResolvedReferences {
  /** Completion (or the reason there isn't one) for each reference node, by node id. */
  externals: Record<string, ExternalTime>;
  /** Changes whenever any project this one depends on (directly or not) changes on disk. "" if none. */
  referencesVersion: string;
}

interface Visit {
  key: string;
  name: string;
}

/**
 * Works out the completion time of every reference node in `project` by opening the projects they
 * point at, recursively. `self` is where `project` lives, so a loop back to it is caught.
 */
export async function resolveReferences(project: Project, self: StorageDescriptor, adapterFor: AdapterLookup): Promise<ResolvedReferences> {
  const versions = new Set<string>();
  const externals = await resolve(project, [{ key: storageKey(self), name: project.name }], adapterFor, versions);
  const referencesVersion = versions.size
    ? createHash("sha256").update([...versions].sort().join("\n")).digest("hex").slice(0, 16)
    : "";
  return { externals, referencesVersion };
}

async function resolve(
  project: Project,
  stack: Visit[],
  adapterFor: AdapterLookup,
  versions: Set<string>,
): Promise<Record<string, ExternalTime>> {
  const externals: Record<string, ExternalTime> = {};
  for (const node of project.nodes) {
    if (!node.ref) continue;
    externals[node.id] = await resolveOne(node.ref.storage, stack, adapterFor, versions);
  }
  return externals;
}

async function resolveOne(
  target: StorageDescriptor,
  stack: Visit[],
  adapterFor: AdapterLookup,
  versions: Set<string>,
): Promise<ExternalTime> {
  const key = storageKey(target);
  const adapter = adapterFor(target);
  if (!adapter) return { error: `Storage kind "${target.kind}" is not supported yet` };
  try {
    const loaded = await adapter.load(target);
    versions.add(`${key}@${loaded.version}`);
    const loop = stack.findIndex((visit) => visit.key === key);
    if (loop >= 0) return { error: "cycle", cycle: [...stack.slice(loop).map((v) => v.name), loaded.project.name] };

    const inner = await resolve(loaded.project, [...stack, { key, name: loaded.project.name }], adapterFor, versions);
    const result = schedule(loaded.project, inner);
    const root = result.nodes[loaded.project.rootId];
    if (root) return { completion: root.completion };
    const loopHere = result.projectCycles[0];
    if (loopHere) return { error: "cycle", cycle: loopHere.path };
    return { error: result.errors[loaded.project.rootId] ?? `"${loaded.project.name}" has no completion date` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
