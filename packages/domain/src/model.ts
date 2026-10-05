/** A unit of work in a project graph. `workTime` keeps its human form, e.g. "1w 2d". */
export interface ProjectNode {
  id: string;
  title: string;
  workTime: string;
  /** ISO 8601 date-time; the node cannot start before this. */
  notBefore?: string;
  labels: string[];
  description: string;
  links: string[];
}

/** The dependent cannot complete before the dependency. */
export interface Dependency {
  dependentId: string;
  dependencyId: string;
}

export interface Project {
  id: string;
  name: string;
  /** ISO 8601 date-time anchoring nodes with no not-before date and no dependencies. */
  start: string;
  /** The single top-level node: the project's success criteria. */
  rootId: string;
  nodes: ProjectNode[];
  edges: Dependency[];
}

/** Where a project is stored. More kinds arrive with later slices. */
export type StorageDescriptor = { kind: "csv"; path: string };

export interface LoadedProject {
  project: Project;
  /** Opaque token that changes whenever the stored project changes. */
  version: string;
}

/**
 * Every store implements this and passes the shared conformance suite in
 * @dep-tracker/storage-conformance.
 */
export interface StorageAdapter<D extends StorageDescriptor = StorageDescriptor> {
  readonly kind: D["kind"];
  /** Write a new project; rejects with ProjectExistsError if one is already there. */
  create(descriptor: D, project: Project): Promise<string>;
  load(descriptor: D): Promise<LoadedProject>;
  /** Replace the stored project; rejects with VersionConflictError if it changed since `expectedVersion`. */
  save(descriptor: D, project: Project, expectedVersion: string): Promise<string>;
  /** Cheap check of the current version, used to detect edits made outside the app. */
  version(descriptor: D): Promise<string>;
}

export class VersionConflictError extends Error {
  constructor(message = "The project changed on disk since it was loaded. Reload it and try again.") {
    super(message);
    this.name = "VersionConflictError";
  }
}

export class ProjectExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectExistsError";
  }
}

export interface NodeTimes {
  start: string;
  completion: string;
  /** Latest completion among the node's dependencies; absent when it has none. */
  dependencyTime?: string;
}

/**
 * cyclic: part of a dependency cycle. blockedByCycle: depends, directly or not,
 * on a cyclic node. orphan: not reachable from the success criteria.
 */
export type NodeFlag = "cyclic" | "blockedByCycle" | "orphan";

export interface Schedule {
  nodes: Record<string, NodeTimes>;
  /** Per-node problems that prevented a node being timed. */
  errors: Record<string, string>;
  /** Only flagged nodes appear. */
  flags: Record<string, NodeFlag[]>;
  /** Each cycle as a closed path following "depends on" edges, e.g. [a, b, a]. */
  cycles: string[][];
}
