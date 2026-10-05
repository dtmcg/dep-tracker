import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Dependency, LoadedProject, Project, ProjectNode, StorageAdapter } from "@dep-tracker/domain";
import { readRecords } from "./csv.ts";

/**
 * CSV store: a folder holding project.csv (one row of metadata), nodes.csv and
 * edges.csv. Multi-value cells (labels, links) are separated by semicolons.
 */
export type CsvDescriptor = { kind: "csv"; path: string };

export class CsvAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvAdapterError";
  }
}

const FILES = { project: "project.csv", nodes: "nodes.csv", edges: "edges.csv" } as const;

async function readText(folder: string, name: string, required: boolean): Promise<string> {
  const file = path.join(folder, name);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!required && code === "ENOENT") return "";
    if (code === "ENOENT") throw new CsvAdapterError(`No ${name} found in ${folder}. Is this a dep-tracker CSV project folder?`);
    throw new CsvAdapterError(`Could not read ${file}: ${(error as Error).message}`);
  }
}

function toIso(value: string, where: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new CsvAdapterError(`${where}: "${value}" is not a valid date-time (use e.g. 2026-11-02T09:00:00Z)`);
  return new Date(ms).toISOString();
}

function splitList(cell: string): string[] {
  return cell
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof CsvAdapterError) throw error;
    throw new CsvAdapterError((error as Error).message);
  }
}

export async function loadCsvProject(folder: string): Promise<LoadedProject> {
  const projectText = await readText(folder, FILES.project, true);
  const nodesText = await readText(folder, FILES.nodes, true);
  const edgesText = await readText(folder, FILES.edges, false);

  return wrap(() => {
    const meta = readRecords(projectText, FILES.project, ["id", "name", "start", "root_id"]).records[0];
    if (!meta) throw new CsvAdapterError(`${FILES.project} has no project row`);

    const seen = new Set<string>();
    const nodes: ProjectNode[] = readRecords(nodesText, FILES.nodes, ["id", "title", "work_time"], [
      "not_before",
      "labels",
      "description",
      "links",
    ]).records.map(({ line, values }) => {
      const id = values.id ?? "";
      if (!id) throw new CsvAdapterError(`${FILES.nodes} line ${line}: id is empty`);
      if (seen.has(id)) throw new CsvAdapterError(`${FILES.nodes} line ${line}: duplicate id "${id}"`);
      seen.add(id);
      const node: ProjectNode = {
        id,
        title: values.title ?? "",
        workTime: values.work_time ?? "",
        labels: splitList(values.labels ?? ""),
        description: values.description ?? "",
        links: splitList(values.links ?? ""),
      };
      if (values.not_before) node.notBefore = toIso(values.not_before, `${FILES.nodes} line ${line}, not_before`);
      return node;
    });

    const edges: Dependency[] = edgesText
      ? readRecords(edgesText, FILES.edges, ["dependent_id", "dependency_id"]).records.map(({ values }) => ({
          dependentId: values.dependent_id ?? "",
          dependencyId: values.dependency_id ?? "",
        }))
      : [];

    const rootId = meta.values.root_id ?? "";
    if (!seen.has(rootId)) throw new CsvAdapterError(`${FILES.project}: root_id "${rootId}" is not an id in ${FILES.nodes}`);

    const project: Project = {
      id: meta.values.id ?? "",
      name: meta.values.name ?? "",
      start: toIso(meta.values.start ?? "", `${FILES.project}, start`),
      rootId,
      nodes,
      edges,
    };
    const version = createHash("sha256")
      .update(projectText)
      .update("\0")
      .update(nodesText)
      .update("\0")
      .update(edgesText)
      .digest("hex")
      .slice(0, 16);
    return { project, version };
  });
}

export const csvAdapter: StorageAdapter<CsvDescriptor> = {
  kind: "csv",
  load: (descriptor) => loadCsvProject(descriptor.path),
};
