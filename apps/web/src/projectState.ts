import { applyCommands, type Command, type ExternalTime, type Project, type ProjectNode, type StorageDescriptor, schedule, type Schedule } from "@dep-tracker/domain";

export interface Snapshot {
  project: Project;
  schedule: Schedule;
  externals?: Record<string, ExternalTime>;
}

/** Commands for "Add dependency": a new node plus the edge from the dependent to it (FR-9). */
export function dependencyCommands(
  dependentId: string,
  input: { title: string; workTime: string },
  id: string,
): Command[] {
  return [
    {
      type: "addNode",
      node: { id, title: input.title.trim(), workTime: input.workTime.trim(), labels: [], description: "", links: [] },
    },
    { type: "addEdge", dependentId, dependencyId: id },
  ];
}

/** Commands for "Add reference": a node standing in for another project's success criteria, needed by `dependentId`. */
export function referenceCommands(dependentId: string, input: { title: string; storage: StorageDescriptor }, id: string): Command[] {
  return [
    {
      type: "addNode",
      node: { id, title: input.title.trim(), workTime: "0m", labels: [], description: "", links: [], ref: { storage: input.storage } },
    },
    { type: "addEdge", dependentId, dependencyId: id },
  ];
}

/** Optimistic update: apply commands in the browser with the shared domain engine (FR-11, FR-12). */
export function applyLocally(snapshot: Snapshot, commands: Command[]): Snapshot {
  const project = applyCommands(snapshot.project, commands);
  return { project, schedule: schedule(project, snapshot.externals), externals: snapshot.externals };
}

/** Success criteria first, then by completion; untimed nodes last. */
export function displayOrder(project: Project, sched: Schedule): ProjectNode[] {
  const key = (node: ProjectNode) => sched.nodes[node.id]?.completion ?? "￿";
  const rest = project.nodes
    .filter((n) => n.id !== project.rootId)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.title.localeCompare(b.title)));
  const root = project.nodes.find((n) => n.id === project.rootId);
  return root ? [root, ...rest] : rest;
}
