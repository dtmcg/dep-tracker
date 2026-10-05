import { parseDuration } from "./duration.ts";
import type { Dependency, Project, ProjectNode } from "./model.ts";

/** Edits to a project. Batches apply all-or-nothing. */
export type Command =
  | { type: "addNode"; node: ProjectNode }
  | { type: "addEdge"; dependentId: string; dependencyId: string };

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
  return { ...node, title, workTime: node.workTime.trim() };
}

function apply(project: Project, command: Command): Project {
  switch (command.type) {
    case "addNode": {
      const node = validNode(command.node);
      if (project.nodes.some((n) => n.id === node.id)) throw new CommandError(`A node with id "${node.id}" already exists`);
      return { ...project, nodes: [...project.nodes, node] };
    }
    case "addEdge": {
      const { dependentId, dependencyId } = command;
      for (const id of [dependentId, dependencyId]) {
        if (!project.nodes.some((n) => n.id === id)) throw new CommandError(`No node with id "${id}"`);
      }
      if (project.edges.some((e) => e.dependentId === dependentId && e.dependencyId === dependencyId)) {
        throw new CommandError("That dependency already exists");
      }
      const edge: Dependency = { dependentId, dependencyId };
      return { ...project, edges: [...project.edges, edge] };
    }
    default:
      throw new CommandError(`Unknown command ${JSON.stringify((command as { type?: unknown }).type)}`);
  }
}

/** Apply a batch of commands, returning a new project. Throws CommandError and leaves the input untouched. */
export function applyCommands(project: Project, commands: Command[]): Project {
  return commands.reduce(apply, project);
}
