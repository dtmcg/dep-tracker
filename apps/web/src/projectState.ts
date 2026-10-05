import { applyCommands, type Command, type Project, type ProjectNode, schedule, type Schedule } from "@dep-tracker/domain";

export interface Snapshot {
  project: Project;
  schedule: Schedule;
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

/** Optimistic update: apply commands in the browser with the shared domain engine (FR-11, FR-12). */
export function applyLocally(snapshot: Snapshot, commands: Command[]): Snapshot {
  const project = applyCommands(snapshot.project, commands);
  return { project, schedule: schedule(project) };
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
