import { parseDuration } from "./duration.ts";
import type { Dependency, Project, ProjectNode, Resource, ResourceRequirement, ResourceType, StorageDescriptor } from "./model.ts";
import { STORAGE_KINDS } from "./reference.ts";

export type NodeChanges = Partial<Omit<ProjectNode, "id" | "notBefore">> & { notBefore?: string | null };

/** Edits to a project. Batches apply all-or-nothing. */
export type Command =
  | { type: "addNode"; node: ProjectNode }
  | { type: "updateNode"; id: string; changes: NodeChanges }
  | { type: "removeNode"; id: string }
  | { type: "addEdge"; dependentId: string; dependencyId: string }
  | { type: "removeEdge"; dependentId: string; dependencyId: string }
  | { type: "setLabelColour"; label: string; colour: string | null }
  | { type: "addResourceType"; name: string }
  | { type: "removeResourceType"; name: string }
  /** `index` is where in the type's list it goes; the end if left out. */
  | { type: "addResource"; typeName: string; resource: Resource; index?: number }
  | { type: "removeResource"; typeName: string; id: string };

/** Commands that change the resource pool, which only work when the Resourcing feature is on. */
export const RESOURCE_COMMANDS: readonly Command["type"][] = ["addResourceType", "removeResourceType", "addResource", "removeResource"];

/** Whether a command is part of the Resourcing feature: a pool command, or a node edit that sets resource requirements. */
export function usesResourcing(command: Command): boolean {
  if (RESOURCE_COMMANDS.includes(command?.type)) return true;
  if (command?.type === "updateNode") return "resources" in (command.changes ?? {});
  if (command?.type === "addNode") return (command.node?.resources ?? []).length > 0;
  return false;
}

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const FROM_OTHER_PROJECT = "A reference takes its time from the other project, so its work time and not-before date can't be set here";

function validReference(node: ProjectNode): ProjectNode {
  const storage = node.ref!.storage;
  const kind = String(storage?.kind ?? "");
  const path = String(storage?.path ?? "").trim();
  if (!(STORAGE_KINDS as readonly string[]).includes(kind)) {
    throw new CommandError(`A reference can't point at a "${kind}" project; use one of ${STORAGE_KINDS.join(", ")}`);
  }
  if (!path) throw new CommandError("A reference needs the location of the other project");
  const { notBefore: _ignored, ...rest } = node;
  return {
    ...rest,
    workTime: "0m",
    ref: { storage: { kind, path } as StorageDescriptor },
  };
}

/** A node's resource requirements: each names a type in the pool, once, with a whole number of at least 1. */
function validRequirements(node: ProjectNode, project: Project): ResourceRequirement[] {
  const wanted = node.resources ?? [];
  if (wanted.length && node.ref) throw new CommandError("A reference takes its time from the other project, so it can't need resources here");
  const seen = new Set<string>();
  return wanted.map((requirement) => {
    const type = (project.resourceTypes ?? []).find((t) => sameName(t.name, String(requirement.typeName ?? "")));
    if (!type) throw new CommandError(`"${String(requirement.typeName ?? "").trim()}" is not a resource type in this project`);
    if (!Number.isInteger(requirement.count) || requirement.count < 1) {
      throw new CommandError(`${type.name}: the number needed must be a whole number, at least 1`);
    }
    if (seen.has(type.name)) throw new CommandError(`${type.name} is listed twice`);
    seen.add(type.name);
    return { typeName: type.name, count: requirement.count };
  });
}

function validNode(node: ProjectNode, project: Project): ProjectNode {
  const title = node.title.trim();
  if (!node.id) throw new CommandError("A node needs an id");
  if (!title) throw new CommandError("A node needs a title");
  if (node.ref) {
    node = validReference(node);
  } else {
    try {
      // A work time is optional; a node without one is simply not yet estimated.
      if (node.workTime.trim()) parseDuration(node.workTime);
    } catch (error) {
      throw new CommandError((error as Error).message);
    }
    if (node.notBefore !== undefined && Number.isNaN(Date.parse(node.notBefore))) {
      throw new CommandError(`"${node.notBefore}" is not a valid not-before date-time`);
    }
  }
  const resources = validRequirements(node, project);
  const clean: ProjectNode = {
    ...node,
    title,
    workTime: node.workTime.trim(),
    labels: [...new Set(node.labels.map((l) => l.trim()).filter(Boolean))],
    links: node.links.map((l) => l.trim()).filter(Boolean),
  };
  if (resources.length) clean.resources = resources;
  else delete clean.resources;
  if (clean.notBefore !== undefined) clean.notBefore = new Date(Date.parse(clean.notBefore)).toISOString();
  return clean;
}

function findNode(project: Project, id: string): ProjectNode {
  const node = project.nodes.find((n) => n.id === id);
  if (!node) throw new CommandError(`No node with id "${id}"`);
  return node;
}

function findType(project: Project, name: string): ResourceType {
  const type = (project.resourceTypes ?? []).find((t) => sameName(t.name, name));
  if (!type) throw new CommandError(`No resource type "${name.trim()}"`);
  return type;
}

function validResource(resource: Resource, project: Project): Resource {
  if (!resource.id) throw new CommandError("A resource needs an id");
  if ((project.resourceTypes ?? []).some((t) => t.resources.some((r) => r.id === resource.id))) {
    throw new CommandError(`A resource with id "${resource.id}" already exists`);
  }
  const available = (resource.available ?? "").trim();
  try {
    if (available) parseDuration(available);
  } catch (error) {
    throw new CommandError(`Available time: ${(error as Error).message}`);
  }
  return { id: resource.id, name: (resource.name ?? "").trim(), available };
}

const withTypes = (project: Project, types: ResourceType[]): Project => ({ ...project, resourceTypes: types });

const sameEdge = (a: Dependency, b: Dependency) => a.dependentId === b.dependentId && a.dependencyId === b.dependencyId;

function apply(project: Project, command: Command): Project {
  switch (command.type) {
    case "addNode": {
      const node = validNode(command.node, project);
      if (project.nodes.some((n) => n.id === node.id)) throw new CommandError(`A node with id "${node.id}" already exists`);
      return { ...project, nodes: [...project.nodes, node] };
    }
    case "updateNode": {
      const current = findNode(project, command.id);
      if (current.ref && (command.changes.workTime !== undefined || command.changes.notBefore !== undefined)) {
        throw new CommandError(FROM_OTHER_PROJECT);
      }
      if (!current.ref && command.changes.ref !== undefined) {
        throw new CommandError("A reference can only be added as a new node");
      }
      const { notBefore, ...rest } = command.changes;
      const merged: ProjectNode = { ...current, ...rest, id: current.id };
      if (notBefore === null) delete merged.notBefore;
      else if (notBefore !== undefined) merged.notBefore = notBefore;
      const node = validNode(merged, project);
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
      if (findNode(project, edge.dependentId).ref) {
        throw new CommandError("A reference takes its time from the other project, so it can't depend on anything here");
      }
      findNode(project, edge.dependencyId);
      if (project.edges.some((e) => sameEdge(e, edge))) throw new CommandError("That dependency already exists");
      return { ...project, edges: [...project.edges, edge] };
    }
    case "removeEdge": {
      const edge: Dependency = { dependentId: command.dependentId, dependencyId: command.dependencyId };
      if (!project.edges.some((e) => sameEdge(e, edge))) throw new CommandError("There is no such dependency to remove");
      return { ...project, edges: project.edges.filter((e) => !sameEdge(e, edge)) };
    }
    case "setLabelColour": {
      const label = command.label.trim();
      if (!label) throw new CommandError("A label needs a name");
      const colours = { ...(project.labelColours ?? {}) };
      if (command.colour === null) delete colours[label];
      else if (/^#[0-9a-f]{6}$/i.test(command.colour)) colours[label] = command.colour.toLowerCase();
      else throw new CommandError(`"${command.colour}" is not a colour; use #rrggbb`);
      return { ...project, labelColours: colours };
    }
    case "addResourceType": {
      const name = command.name.trim();
      if (!name) throw new CommandError("A resource type needs a name");
      const types = project.resourceTypes ?? [];
      if (types.some((t) => sameName(t.name, name))) throw new CommandError(`There is already a resource type "${name}"`);
      return withTypes(project, [...types, { name, resources: [] }]);
    }
    case "removeResourceType": {
      const type = findType(project, command.name);
      // Work items can't keep asking for a type that no longer exists.
      const nodes = project.nodes.map((n) => {
        const kept = (n.resources ?? []).filter((r) => !sameName(r.typeName, type.name));
        if (kept.length === (n.resources ?? []).length) return n;
        const { resources: _dropped, ...rest } = n;
        return kept.length ? { ...rest, resources: kept } : rest;
      });
      return withTypes({ ...project, nodes }, (project.resourceTypes ?? []).filter((t) => t !== type));
    }
    case "addResource": {
      const type = findType(project, command.typeName);
      const resource = validResource(command.resource, project);
      const at = Math.min(Math.max(command.index ?? type.resources.length, 0), type.resources.length);
      const resources = [...type.resources.slice(0, at), resource, ...type.resources.slice(at)];
      return withTypes(project, (project.resourceTypes ?? []).map((t) => (t === type ? { ...t, resources } : t)));
    }
    case "removeResource": {
      const type = findType(project, command.typeName);
      if (!type.resources.some((r) => r.id === command.id)) throw new CommandError(`No resource with id "${command.id}" in ${type.name}`);
      const resources = type.resources.filter((r) => r.id !== command.id);
      return withTypes(project, (project.resourceTypes ?? []).map((t) => (t === type ? { ...t, resources } : t)));
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
        // [] rather than undefined: undefined would vanish when the command is sent as JSON.
        else if (key === "resources") changes.resources = current.resources ?? [];
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
    case "setLabelColour":
      return [{ type: "setLabelColour", label: command.label, colour: before.labelColours?.[command.label.trim()] ?? null }];
    case "addResourceType":
      return [{ type: "removeResourceType", name: command.name }];
    case "removeResourceType": {
      const type = findType(before, command.name);
      return [
        { type: "addResourceType", name: type.name },
        ...type.resources.map((resource): Command => ({ type: "addResource", typeName: type.name, resource })),
        // and the work items that needed it
        ...before.nodes
          .filter((n) => (n.resources ?? []).some((r) => sameName(r.typeName, type.name)))
          .map((n): Command => ({ type: "updateNode", id: n.id, changes: { resources: n.resources } })),
      ];
    }
    case "addResource":
      return [{ type: "removeResource", typeName: command.typeName, id: command.resource.id }];
    case "removeResource": {
      const type = findType(before, command.typeName);
      const index = type.resources.findIndex((r) => r.id === command.id);
      return [{ type: "addResource", typeName: type.name, resource: type.resources[index]!, index }];
    }
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
