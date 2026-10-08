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
  /** Resources this work item needs (Resourcing feature); none if absent or empty. */
  resources?: ResourceRequirement[];
  /**
   * Set on a reference node (FR-6): it stands in for the success criteria of
   * the project stored at `ref.storage`. Its completion is that project's
   * completion; it has no work time of its own ("0m") and no dependencies.
   */
  ref?: ReferenceTarget;
}

/** What a work item needs from the resource pool: `count` resources of the named type, e.g. a Developer x 2. */
export interface ResourceRequirement {
  typeName: string;
  /** How many are allocated now; within min and max when those are set. */
  count: number;
  /** Fewest the item can do with (a whole number, at least 1); absent for no lower limit. */
  min?: number;
  /** Most it can use (a whole number, at least min); absent for no upper limit. */
  max?: number;
}

export interface ReferenceTarget {
  storage: StorageDescriptor;
}

/** The dependent cannot complete before the dependency. */
export interface Dependency {
  dependentId: string;
  dependencyId: string;
}

/** One member of a resource pool: a person, machine or anything else that can do work. Every field but the id is optional. */
export interface Resource {
  id: string;
  name: string;
  /** How much working time it has, in the work time format ("40h", "3d"). Empty means continuously available. */
  available: string;
}

/** A kind of resource ("Developer", "Test rig") and the instances of it in the pool. Types are identified by name. */
export interface ResourceType {
  name: string;
  resources: Resource[];
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
  /** Chosen colour per label, as #rrggbb (FR-20). Labels without one use a default. */
  labelColours?: Record<string, string>;
  /** The project's resource pool (Resourcing feature). */
  resourceTypes?: ResourceType[];
}

/**
 * Where a project is stored. Only CSV folders for now; another store is one more member of this union, one more
 * entry in STORAGE_KINDS, and an adapter that passes the storage conformance suite.
 */
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
 * cyclic: part of a dependency cycle (inside this project or across projects).
 * blockedByCycle: depends, directly or not, on a cyclic node. unresolved: a
 * reference whose project can't be read or scheduled. blockedByReference:
 * depends, directly or not, on an unresolved reference. orphan: not reachable
 * from the success criteria.
 */
export type NodeFlag = "cyclic" | "blockedByCycle" | "unresolved" | "blockedByReference" | "orphan" | "unestimated";

/**
 * What the server learned about another project for a reference node: its
 * root's completion, or why that couldn't be worked out. `cycle` is set when
 * the reason is a loop of references, as project names, e.g. [A, B, A].
 */
export type ExternalTime = { completion: string } | { error: string; cycle?: string[] };

export interface Schedule {
  nodes: Record<string, NodeTimes>;
  /** Per-node problems that prevented a node being timed. */
  errors: Record<string, string>;
  /** Only flagged nodes appear. */
  flags: Record<string, NodeFlag[]>;
  /** Each cycle as a closed path following "depends on" edges, e.g. [a, b, a]. */
  cycles: string[][];
  /** Reference nodes caught in a loop of references between projects, with the project names in the loop. */
  projectCycles: { nodeId: string; path: string[] }[];
}
