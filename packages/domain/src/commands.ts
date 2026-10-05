import { parseDuration } from "./duration.ts";
import type { Dependency, Project, ProjectNode } from "./model.ts";

export type NodeChanges = Partial<Omit<ProjectNode, "id" | "notBefore">> & { notBefore?: string | null };

/** Edits to a project. Batches apply all-or-nothing. */
export type Command =
  | { type: "addNode"; node: ProjectNode }
  | { type: "updateNode"; id: string; changes: NodeChanges }
  | { type: "removeNode"; id: string }
  | { type: "addEdge"; dependentId: string; dependencyId: string }
  | { type: "removeEdge"; dependentId: string; dependencyId: string };

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

function validNode(node: ProjectNode): ProjectNode {
  const title = node.title.trim();
  if (!node.id) throw new CommandError("A node needs an id");
  if (!title) throw new CommandError("A node needs a title");
  try {
    parseDuration(node.workTime);
  } catch (error) {
    throw new CommandError((error as Error).message);
  }
  if (node.notBefore !== undefined && Number.isNaN(Date.parse(node.notBefore))) {
    throw new CommandError(`"${node.notBefore}" is not a valid not-before date-time`);
  }
  const clean: ProjectNode = {
    ...node,
    title,
    workTime: node.workTime.trim(),
    labels: node.labels.map((l) => l.trim()).filter(Boolean),
    links: node.links.map((l) => l.trim()).filter(Boolean),
  };
  if (clean.notBefore !== undefined) clean.notBefore = new Date(Date.parse(clean.notBefore)).toISOString();
  return clean;
}

function findNode(project: Project, id: string): ProjectNode {
  const node = project.nodes.find((n) => n.id === id);
  if (!node) throw new CommandError(`No node with id "${id}"`);
  return node;
}

const sameEdge = (a: Dependency, b: Dependency) => a.dependentId === b.dependentId && a.dependencyId === b.dependencyId;

function apply(project: Project, command: Command): Project {
  switch (command.type) {
    case "addNode": {
      const node = validNode(command.node);
      if (project.nodes.some((n) => n.id === node.id)) throw new CommandError(`A node with id "${node.id}" already exists`);
      return { ...project, nodes: [...project.nodes, node] };
    }
    case "updateNode": {
      const current = findNode(project, command.id);
      const { notBefore, ...rest } = command.changes;
      const merged: ProjectNode = { ...current, ...rest, id: current.id };
      if (notBefore === null) delete merged.notBefore;
      else if (notBefore !== undefined) merged.notBefore = notBefore;
      const node = validNode(merged);
      return { ...project, nodes: project.nodes.map((n) => (n.id === node.id ? node : n)) };
    }
    case "removeNode": {
      findNode(project, command.id);
      if (command.id === project.rootId) throw new CommandError("The success criteria node cannot be deleted");
      return {
        ...project,
        nodes: project.nodes.filter((n) => n.id !== command.id),
        edges: project.edges.filter((e) => e.dependentId !== command.id && e.dependencyId !== command.id),
      };
    }
    case "addEdge": {
      const edge: Dependency = { dependentId: command.dependentId, dependencyId: command.dependencyId };
      findNode(project, edge.dependentId);
      findNode(project, edge.dependencyId);
      if (project.edges.some((e) => sameEdge(e, edge))) throw new CommandError("That dependency already exists");
      return { ...project, edges: [...project.edges, edge] };
    }
    case "removeEdge": {
      const edge: Dependency = { dependentId: command.dependentId, dependencyId: command.dependencyId };
      if (!project.edges.some((e) => sameEdge(e, edge))) throw new CommandError("There is no such dependency to remove");
      return { ...project, edges: project.edges.filter((e) => !sameEdge(e, edge)) };
    }
    default:
      throw new CommandError(`Unknown command ${JSON.stringify((command as { type?: unknown }).type)}`);
  }
}

/** Apply a batch of commands, returning a new project. Throws CommandError and leaves the input untouched. */
export function applyCommands(project: Project, commands: Command[]): Project {
  return commands.reduce(apply, project);
}

function inverseOf(before: Project, command: Command): Command[] {
  switch (command.type) {
    case "addNode":
      return [{ type: "removeNode", id: command.node.id }];
    case "updateNode": {
      const current = findNode(before, command.id);
      const changes: NodeChanges = {};
      for (const key of Object.keys(command.changes) as (keyof NodeChanges)[]) {
        if (key === "notBefore") changes.notBefore = current.notBefore ?? null;
        else (changes as Record<string, unknown>)[key] = current[key];
      }
      return [{ type: "updateNode", id: command.id, changes }];
    }
    case "removeNode": {
      const node = findNode(before, command.id);
      const edges = before.edges.filter((e) => e.dependentId === node.id || e.dependencyId === node.id);
      return [{ type: "addNode", node }, ...edges.map((e): Command => ({ type: "addEdge", ...e }))];
    }
    case "addEdge":
      return [{ type: "removeEdge", dependentId: command.dependentId, dependencyId: command.dependencyId }];
    case "removeEdge":
      return [{ type: "addEdge", dependentId: command.dependentId, dependencyId: command.dependencyId }];
  }
}

/** Commands that undo `commands` when applied to the project they produced (FR-13). */
export function invertCommands(before: Project, commands: Command[]): Command[] {
  const inverses: Command[][] = [];
  let state = before;
  for (const command of commands) {
    inverses.push(inverseOf(state, command));
    state = apply(state, command);
  }
  return inverses.reverse().flat();
}
