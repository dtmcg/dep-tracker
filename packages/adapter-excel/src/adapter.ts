import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type LoadedProject, type Project, ProjectExistsError, type StorageAdapter, VersionConflictError } from "@dep-tracker/domain";
import { LayoutError, projectFromSheets, sheetsForProject, titleIndex } from "@dep-tracker/sheet-layout";
import { readWorkbook, type Workbook, writeWorkbook } from "@dep-tracker/xlsx";

export { TASK_COLUMNS } from "@dep-tracker/sheet-layout";

/** Titles → ids from the last read of each workbook, so renames made by hand keep their links. */
const knownTitles = new Map<string, Map<string, string>>();
const remember = (file: string, project: Project) =>
  knownTitles.set(path.resolve(file), titleIndex(project, knownTitles.get(path.resolve(file))));

function parse(wb: Workbook, file: string): Project {
  try {
    const project = projectFromSheets(wb, path.basename(file, path.extname(file)), { knownTitles: knownTitles.get(path.resolve(file)) });
    remember(file, project);
    return project;
  } catch (error) {
    if (error instanceof LayoutError) throw new ExcelAdapterError(error.message);
    throw error;
  }
}

/**
 * Excel store: one .xlsx workbook in the shared Project / Tasks / Labels layout
 * (@dep-tracker/sheet-layout). Other sheets and extra Tasks columns are kept
 * when the app saves.
 */
export type ExcelDescriptor = { kind: "excel"; path: string };

export class ExcelAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelAdapterError";
  }
}

const versionOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

async function readBytes(file: string): Promise<Buffer> {
  try {
    return await readFile(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new ExcelAdapterError(`No workbook found at ${file}`);
    if (code === "EBUSY") throw new ExcelAdapterError(`${file} is locked by another program; close it and try again`);
    throw new ExcelAdapterError(`Could not read ${file}: ${(error as Error).message}`);
  }
}

function readParsed(bytes: Buffer, file: string): Project {
  let wb: Workbook;
  try {
    wb = readWorkbook(bytes);
  } catch (error) {
    throw new ExcelAdapterError(`${path.basename(file)} is not a readable .xlsx workbook: ${(error as Error).message}`);
  }
  return parse(wb, file);
}

/** Atomic write: the old file is kept as .bak, the new one lands via rename. */
async function writeAtomically(file: string, bytes: Buffer, keepBackup: boolean): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    if (keepBackup) await copyFile(file, `${file}.bak`);
    await writeFile(temp, bytes);
    await rename(temp, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      throw new ExcelAdapterError(`${path.basename(file)} is open in another program (Excel locks open workbooks). Close it and try again.`);
    }
    throw error;
  }
}

export const excelAdapter: StorageAdapter<ExcelDescriptor> = {
  kind: "excel",

  async load(descriptor) {
    const bytes = await readBytes(descriptor.path);
    return { project: readParsed(bytes, descriptor.path), version: versionOf(bytes) } satisfies LoadedProject;
  },

  async version(descriptor) {
    return versionOf(await readBytes(descriptor.path));
  },

  async create(descriptor, project) {
    const exists = await readFile(descriptor.path).then(
      () => true,
      () => false,
    );
    if (exists) throw new ProjectExistsError(`${descriptor.path} already exists`);
    const bytes = writeWorkbook(sheetsForProject(project, undefined));
    await writeAtomically(descriptor.path, bytes, false);
    remember(descriptor.path, project);
    return versionOf(bytes);
  },

  async save(descriptor, project, expectedVersion) {
    const current = await readBytes(descriptor.path);
    if (versionOf(current) !== expectedVersion) throw new VersionConflictError();
    const options = { knownTitles: knownTitles.get(path.resolve(descriptor.path)) };
    const bytes = writeWorkbook(sheetsForProject(project, readWorkbook(current), options), current);
    await writeAtomically(descriptor.path, bytes, true);
    remember(descriptor.path, project);
    return versionOf(bytes);
  },
};
