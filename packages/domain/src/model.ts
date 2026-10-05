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
 * Every store implements this. Slice S0 needs `load`; create, save and watch
 * arrive with the slices that use them, together with the conformance suite.
 */
export interface StorageAdapter<D extends StorageDescriptor = StorageDescriptor> {
  readonly kind: D["kind"];
  load(descriptor: D): Promise<LoadedProject>;
}

export interface NodeTimes {
  start: string;
  completion: string;
}

export interface Schedule {
  nodes: Record<string, NodeTimes>;
  /** Per-node problems that prevented a node being timed. */
  errors: Record<string, string>;
}
