import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type Dependency,
  formatReference,
  type LoadedProject,
  parseReference,
  type Project,
  ProjectExistsError,
  type ProjectNode,
  type StorageAdapter,
  VersionConflictError,
} from "@dep-tracker/domain";
import { type Data, type Note, parseNote, type Value, writeNote } from "./frontmatter.ts";

/**
 * Obsidian store: a folder in a vault with one note per task, named by its
 * title. Frontmatter holds id, work_time, not_before, depends_on (wikilinks),
 * tags and links; the note body is the description. A project note,
 * "<name> (project).md", holds the start, the success criteria (a wikilink)
 * and label colours. Labels map to tags with ":" written as "/" (Obsidian tags
 * can't contain ":"). Other notes in the folder are left alone.
 */
export type ObsidianDescriptor = { kind: "obsidian"; path: string };

export class ObsidianAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObsidianAdapterError";
  }
}

const TASK_KEYS = new Set(["id", "title", "work_time", "not_before", "depends_on", "tags", "links", "reference"]);
const PROJECT_KEYS = new Set(["dep_tracker", "id", "name", "start", "success_criteria", "label_colours"]);
const PROJECT_SUFFIX = " (project)";

interface NoteFile {
  file: string;
  text: string;
  note: Note;
}

const str = (v: Value | undefined): string => (typeof v === "string" ? v : "");
const list = (v: Value | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);
const stem = (file: string) => file.replace(/\.md$/i, "");

/** "[[Target#Heading|Alias]]" → "Target"; a bare title is taken as is. */
function linkTarget(link: string): string {
  const m = /^\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(link.trim());
  return (m ? m[1]! : link).trim();
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Obsidian's date-time property format, in local time. */
function localDateTime(iso: string): string {
  const d = new Date(iso);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getSeconds() ? `${base}:${pad(d.getSeconds())}` : base;
}

function toIso(value: string, where: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ObsidianAdapterError(`${where}: "${value}" is not a date and time`);
  return new Date(ms).toISOString();
}

const tagOf = (label: string) => label.replace(/:/g, "/").replace(/\s+/g, "-");
const labelOf = (tag: string) => tag.replace(/^#/, "").replace(/\//g, ":");

/** A title as a file name that works on Windows, macOS and Linux and in Obsidian links. */
export function fileNameFor(title: string): string {
  let name = title
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120);
  if (!name) name = "Untitled";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += "-";
  return name;
}

async function readNotes(folder: string): Promise<NoteFile[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ObsidianAdapterError(`No folder at ${folder}`);
    throw error;
  }
  const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md")).map((e) => e.name).sort();
  return Promise.all(
    files.map(async (file) => {
      const text = await readFile(path.join(folder, file), "utf8");
      return { file, text, note: parseNote(text) };
    }),
  );
}

const isProjectNote = (n: NoteFile) => n.note.data.dep_tracker === "project";
const isTaskNote = (n: NoteFile) => !isProjectNote(n) && ("id" in n.note.data || "work_time" in n.note.data);

function versionOf(notes: NoteFile[]): string {
  const hash = createHash("sha256");
  for (const n of notes.filter((x) => isProjectNote(x) || isTaskNote(x))) hash.update(n.file).update("\0").update(n.text).update("\0");
  return hash.digest("hex").slice(0, 16);
}

/** Read the folder. Task notes without an id get one derived from the file name. */
function parse(notes: NoteFile[], folder: string): { project: Project; idOf: Map<string, string> } {
  const projectNote = notes.find(isProjectNote);
  if (!projectNote) throw new ObsidianAdapterError(`No dep-tracker project note in ${folder} (a note with "dep_tracker: project" in its frontmatter)`);
  const tasks = notes.filter(isTaskNote);

  const ids = new Set<string>();
  const idOf = new Map<string, string>(); // file → id
  const nodes: ProjectNode[] = tasks.map(({ file, note }) => {
    let id = str(note.data.id).trim();
    if (!id) {
      id = `note-${fileNameFor(stem(file)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      while (ids.has(id)) id += "-x";
    }
    if (ids.has(id)) throw new ObsidianAdapterError(`${file}: another note already has id "${id}"`);
    ids.add(id);
    idOf.set(file, id);
    const node: ProjectNode = {
      id,
      title: str(note.data.title).trim() || stem(file),
      workTime: str(note.data.work_time).trim(),
      labels: list(note.data.tags).map(labelOf).filter(Boolean),
      description: note.body,
      links: list(note.data.links),
    };
    const reference = str(note.data.reference).trim();
    const notBefore = str(note.data.not_before).trim();
    if (reference) {
      // A reference stands in for another project's success criteria; its time comes from there.
      try {
        node.ref = { storage: parseReference(reference) };
      } catch (error) {
        throw new ObsidianAdapterError(`${file}, reference: ${(error as Error).message}`);
      }
      node.workTime = "0m";
    } else if (notBefore) {
      node.notBefore = toIso(notBefore, `${file}, not_before`);
    }
    return node;
  });

  // Links resolve by file name, then title, then id, then ignoring case.
  const resolve = (link: string): string | undefined => {
    const target = linkTarget(link);
    const byFile = tasks.find((t) => stem(t.file) === target);
    if (byFile) return idOf.get(byFile.file);
    const byTitle = nodes.find((n) => n.title === target) ?? nodes.find((n) => n.id === target);
    if (byTitle) return byTitle.id;
    const lower = target.toLowerCase();
    const loose = tasks.find((t) => stem(t.file).toLowerCase() === lower);
    return loose ? idOf.get(loose.file) : nodes.find((n) => n.title.toLowerCase() === lower)?.id;
  };

  const edges: Dependency[] = [];
  for (const { file, note } of tasks) {
    const dependentId = idOf.get(file)!;
    for (const link of list(note.data.depends_on)) {
      const dependencyId = resolve(link);
      if (!dependencyId) throw new ObsidianAdapterError(`${file}: depends_on ${link.includes("[[") ? link : `[[${link}]]`} doesn't match any task note`);
      if (!edges.some((e) => e.dependentId === dependentId && e.dependencyId === dependencyId)) edges.push({ dependentId, dependencyId });
    }
  }

  const data = projectNote.note.data;
  const rootLink = str(data.success_criteria);
  const rootId = rootLink ? resolve(rootLink) : undefined;
  if (!rootId) throw new ObsidianAdapterError(`${projectNote.file}: success_criteria must link to a task note, e.g. "[[Launch]]"`);
  const colours = data.label_colours && typeof data.label_colours === "object" && !Array.isArray(data.label_colours) ? data.label_colours : {};
  const labelColours: Record<string, string> = {};
  for (const [label, colour] of Object.entries(colours)) {
    if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new ObsidianAdapterError(`${projectNote.file}: label colour "${colour}" for ${label} is not #rrggbb`);
    labelColours[label] = colour.toLowerCase();
  }
  const start = str(data.start);
  if (!start) throw new ObsidianAdapterError(`${projectNote.file}: start is missing`);

  return {
    project: {
      id: str(data.id) || fileNameFor(folder),
      name: str(data.name) || stem(projectNote.file).replace(/ \(project\)$/, ""),
      start: toIso(start, `${projectNote.file}, start`),
      rootId,
      nodes,
      edges,
      labelColours,
    },
    idOf,
  };
}

/** The notes for a project, by file name, reusing existing notes' raw frontmatter. */
function render(
  project: Project,
  existing: NoteFile[],
  idOf: Map<string, string>,
): { out: Map<string, string>; fileFor: Map<string, string>; projectFile: string } {
  const fileOfId = new Map<string, string>();
  for (const n of existing) if (idOf.has(n.file)) fileOfId.set(idOf.get(n.file)!, n.file);
  const rawOf = (file: string | undefined) => existing.find((n) => n.file === file)?.note.raw ?? [];

  // File names: keep a note's current name while its title still maps to it; avoid clashes.
  const projectFile = `${fileNameFor(project.name)}${PROJECT_SUFFIX}.md`;
  const taken = new Set<string>([projectFile.toLowerCase()]);
  for (const n of existing) if (!isTaskNote(n) && !isProjectNote(n)) taken.add(n.file.toLowerCase());
  const fileFor = new Map<string, string>();
  for (const node of project.nodes) {
    const current = fileOfId.get(node.id);
    const wanted = `${fileNameFor(node.title)}.md`;
    let file = current && current.toLowerCase() === wanted.toLowerCase() ? current : wanted;
    for (let i = 2; taken.has(file.toLowerCase()); i++) file = `${fileNameFor(node.title)} (${i}).md`;
    taken.add(file.toLowerCase());
    fileFor.set(node.id, file);
  }
  const linkTo = (id: string) => `[[${stem(fileFor.get(id) ?? id)}]]`;

  const out = new Map<string, string>();
  for (const node of project.nodes) {
    const file = fileFor.get(node.id)!;
    const data: Data = { id: node.id };
    if (stem(file) !== node.title) data.title = node.title;
    data.work_time = node.workTime;
    if (node.ref) data.reference = formatReference(node.ref.storage);
    if (node.notBefore) data.not_before = localDateTime(node.notBefore);
    const deps = project.edges.filter((e) => e.dependentId === node.id).map((e) => linkTo(e.dependencyId));
    if (deps.length) data.depends_on = deps;
    if (node.labels.length) data.tags = node.labels.map(tagOf);
    if (node.links.length) data.links = node.links;
    out.set(file, writeNote(data, node.description, rawOf(fileOfId.get(node.id)), TASK_KEYS));
  }

  const projectNote = existing.find(isProjectNote);
  const pdata: Data = { dep_tracker: "project", id: project.id };
  if (stem(projectFile).replace(/ \(project\)$/, "") !== project.name) pdata.name = project.name;
  pdata.start = localDateTime(project.start);
  pdata.success_criteria = linkTo(project.rootId);
  if (Object.keys(project.labelColours ?? {}).length) pdata.label_colours = { ...project.labelColours };
  out.set(projectFile, writeNote(pdata, projectNote?.note.body ?? "", projectNote?.note.raw ?? [], PROJECT_KEYS));
  return { out, fileFor, projectFile };
}

async function writeAtomically(folder: string, file: string, text: string): Promise<void> {
  const temp = path.join(folder, `.${file}.${process.pid}.tmp`);
  await writeFile(temp, text, "utf8");
  await rename(temp, path.join(folder, file));
}

/** Move a file into a hidden folder of the project folder (Obsidian ignores dot-folders). */
async function stash(folder: string, sub: string, file: string): Promise<void> {
  const dir = path.join(folder, sub);
  await mkdir(dir, { recursive: true });
  const existing = new Set(await readdir(dir));
  let name = file;
  for (let i = 2; existing.has(name); i++) name = `${stem(file)} (${i}).md`;
  await rename(path.join(folder, file), path.join(dir, name));
}

export const obsidianAdapter: StorageAdapter<ObsidianDescriptor> = {
  kind: "obsidian",

  async load(descriptor) {
    const notes = await readNotes(descriptor.path);
    return { project: parse(notes, descriptor.path).project, version: versionOf(notes) } satisfies LoadedProject;
  },

  async version(descriptor) {
    return versionOf(await readNotes(descriptor.path));
  },

  async create(descriptor, project) {
    await mkdir(descriptor.path, { recursive: true });
    const notes = await readNotes(descriptor.path);
    if (notes.some(isProjectNote)) throw new ProjectExistsError(`${descriptor.path} already contains a dep-tracker project`);
    const { out } = render(project, notes, new Map());
    for (const [file, text] of out) {
      if (notes.some((n) => n.file.toLowerCase() === file.toLowerCase())) {
        throw new ProjectExistsError(`${descriptor.path} already has a note called ${file}`);
      }
    }
    for (const [file, text] of out) await writeAtomically(descriptor.path, file, text);
    return versionOf(await readNotes(descriptor.path));
  },

  async save(descriptor, project, expectedVersion) {
    const folder = descriptor.path;
    const notes = await readNotes(folder);
    if (versionOf(notes) !== expectedVersion) throw new VersionConflictError();
    const { idOf } = parse(notes, folder);
    const { out, fileFor, projectFile } = render(project, notes, idOf);
    const keep = new Set(project.nodes.map((n) => n.id));

    // Tasks deleted in the app: move their notes to .trash rather than deleting them.
    for (const n of notes.filter(isTaskNote)) if (!keep.has(idOf.get(n.file)!)) await stash(folder, ".trash", n.file);
    // Renamed tasks: move the note to its new name first, so Obsidian-side history follows the file.
    const fileOfId = new Map([...idOf].map(([file, id]) => [id, file]));
    for (const node of project.nodes) {
      const from = fileOfId.get(node.id);
      const to = fileFor.get(node.id)!;
      if (from && from !== to && !out.has(from)) await rename(path.join(folder, from), path.join(folder, to));
    }
    const projectNote = notes.find(isProjectNote)!;
    if (projectNote.file !== projectFile) await rename(path.join(folder, projectNote.file), path.join(folder, projectFile));

    // Write what changed, keeping the previous text in .dep-tracker-backup.
    const current = new Map(notes.map((n) => [n.file, n.text]));
    for (const [file, text] of out) {
      const before = current.get(file);
      if (before === text) continue;
      if (before !== undefined) {
        await mkdir(path.join(folder, ".dep-tracker-backup"), { recursive: true });
        await writeFile(path.join(folder, ".dep-tracker-backup", file), before, "utf8");
      }
      await writeAtomically(folder, file, text);
    }
    return versionOf(await readNotes(folder));
  },
};
