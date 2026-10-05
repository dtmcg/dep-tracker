import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type Dependency,
  type LoadedProject,
  type Project,
  ProjectExistsError,
  type ProjectNode,
  type StorageAdapter,
  VersionConflictError,
} from "@dep-tracker/domain";
import { readRecords, readTable, stringifyCsv } from "./csv.ts";

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
type FileTexts = Record<keyof typeof FILES, string>;

const NODE_COLUMNS = ["id", "title", "work_time", "not_before", "labels", "description", "links"] as const;

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

async function readAll(folder: string): Promise<FileTexts> {
  return {
    project: await readText(folder, FILES.project, true),
    nodes: await readText(folder, FILES.nodes, true),
    edges: await readText(folder, FILES.edges, false),
  };
}

function versionOf(texts: FileTexts): string {
  return createHash("sha256")
    .update(texts.project)
    .update("\0")
    .update(texts.nodes)
    .update("\0")
    .update(texts.edges)
    .digest("hex")
    .slice(0, 16);
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

function parseProject(texts: FileTexts): Project {
  return wrap(() => {
    const meta = readRecords(texts.project, FILES.project, ["id", "name", "start", "root_id"]).records[0];
    if (!meta) throw new CsvAdapterError(`${FILES.project} has no project row`);

    const seen = new Set<string>();
    const nodes: ProjectNode[] = readRecords(texts.nodes, FILES.nodes, ["id", "title", "work_time"], [
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

    const edges: Dependency[] = texts.edges
      ? readRecords(texts.edges, FILES.edges, ["dependent_id", "dependency_id"]).records.map(({ values }) => ({
          dependentId: values.dependent_id ?? "",
          dependencyId: values.dependency_id ?? "",
        }))
      : [];

    const rootId = meta.values.root_id ?? "";
    if (!seen.has(rootId)) throw new CsvAdapterError(`${FILES.project}: root_id "${rootId}" is not an id in ${FILES.nodes}`);

    return {
      id: meta.values.id ?? "",
      name: meta.values.name ?? "",
      start: toIso(meta.values.start ?? "", `${FILES.project}, start`),
      rootId,
      nodes,
      edges,
    };
  });
}

/** Columns in nodes.csv the app doesn't own, with each node's values, so a save keeps them. */
function extraColumns(previousNodes: string): { header: string[]; byId: Map<string, Map<string, string>> } {
  const byId = new Map<string, Map<string, string>>();
  if (!previousNodes) return { header: [...NODE_COLUMNS], byId };
  const { header, rows } = readTable(previousNodes);
  const keys = header.map((h) => h.trim().toLowerCase());
  const idIndex = keys.indexOf("id");
  const known = new Set<string>(NODE_COLUMNS);
  for (const row of rows) {
    const id = idIndex >= 0 ? (row.fields[idIndex] ?? "").trim() : "";
    const extras = new Map<string, string>();
    keys.forEach((key, i) => {
      if (!known.has(key)) extras.set(header[i] ?? key, row.fields[i] ?? "");
    });
    byId.set(id, extras);
  }
  // Keep the file's column order; canonical names for ours, as-written names for theirs.
  const ordered = keys.map((key, i) => (known.has(key) ? key : (header[i] ?? key)));
  for (const column of NODE_COLUMNS) if (!ordered.includes(column)) ordered.push(column);
  return { header: ordered, byId };
}

function serialise(project: Project, previousNodes: string): FileTexts {
  const { header, byId } = extraColumns(previousNodes);
  const nodeRows = project.nodes.map((node) => {
    const ours: Record<string, string> = {
      id: node.id,
      title: node.title,
      work_time: node.workTime,
      not_before: node.notBefore ?? "",
      labels: node.labels.join(";"),
      description: node.description,
      links: node.links.join(";"),
    };
    const extras = byId.get(node.id);
    return header.map((column) => ours[column] ?? extras?.get(column) ?? "");
  });
  return {
    project: stringifyCsv([
      ["id", "name", "start", "root_id"],
      [project.id, project.name, project.start, project.rootId],
    ]),
    nodes: stringifyCsv([header, ...nodeRows]),
    edges: stringifyCsv([["dependent_id", "dependency_id"], ...project.edges.map((e) => [e.dependentId, e.dependencyId])]),
  };
}

async function exists(file: string): Promise<boolean> {
  return readFile(file).then(
    () => true,
    () => false,
  );
}

/** Atomic write: the old file is kept as .bak, the new content lands via rename. */
async function writeAtomically(file: string, text: string): Promise<void> {
  if (await exists(file)) await copyFile(file, `${file}.bak`);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, file);
}

async function writeAll(folder: string, texts: FileTexts): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (const key of Object.keys(FILES) as (keyof typeof FILES)[]) {
    await writeAtomically(path.join(folder, FILES[key]), texts[key]);
  }
}

export async function loadCsvProject(folder: string): Promise<LoadedProject> {
  const texts = await readAll(folder);
  return { project: parseProject(texts), version: versionOf(texts) };
}

export const csvAdapter: StorageAdapter<CsvDescriptor> = {
  kind: "csv",

  load: (descriptor) => loadCsvProject(descriptor.path),

  async version(descriptor) {
    return versionOf(await readAll(descriptor.path));
  },

  async create(descriptor, project) {
    if (await exists(path.join(descriptor.path, FILES.project))) {
      throw new ProjectExistsError(`${descriptor.path} already contains a dep-tracker project`);
    }
    const texts = serialise(project, "");
    await writeAll(descriptor.path, texts);
    return versionOf(texts);
  },

  async save(descriptor, project, expectedVersion) {
    const current = await readAll(descriptor.path);
    if (versionOf(current) !== expectedVersion) throw new VersionConflictError();
    const texts = serialise(project, current.nodes);
    await writeAll(descriptor.path, texts);
    return versionOf(texts);
  },
};
