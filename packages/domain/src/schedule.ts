import { parseDuration } from "./duration.ts";
import type { Project, Schedule } from "./model.ts";

/**
 * Compute start and completion for every node.
 *
 * completion(n) = max(notBefore(n), dependencyTime(n)) + workTime(n), falling
 * back to the project start when neither applies; dependencyTime(n) is the
 * latest completion among n's direct dependencies. A node that cannot be timed
 * leaves its dependents untimed, with the reason recorded in `errors`.
 */
export function schedule(project: Project): Schedule {
  const result: Schedule = { nodes: {}, errors: {} };
  const anchor = Date.parse(project.start);
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  const deps = new Map<string, string[]>();
  for (const e of project.edges) deps.set(e.dependentId, [...(deps.get(e.dependentId) ?? []), e.dependencyId]);

  const completion = new Map<string, number | null>();
  const visiting = new Set<string>();

  const visit = (id: string): number | null => {
    if (completion.has(id)) return completion.get(id)!;
    const node = byId.get(id);
    if (!node) return null;
    if (visiting.has(id)) {
      result.errors[id] = "Part of a dependency cycle";
      return null;
    }
    visiting.add(id);

    let dependencyTime: number | undefined;
    let blockedBy: string | undefined;
    for (const depId of deps.get(id) ?? []) {
      const done = visit(depId);
      if (done === null) blockedBy ??= byId.get(depId)?.title ?? depId;
      else dependencyTime = Math.max(dependencyTime ?? -Infinity, done);
    }
    visiting.delete(id);
    const notBefore = node.notBefore ? Date.parse(node.notBefore) : undefined;
    // Project start applies only when there is neither a not-before date nor a dependency.
    const ready =
      notBefore === undefined && dependencyTime === undefined
        ? anchor
        : Math.max(notBefore ?? -Infinity, dependencyTime ?? -Infinity);

    let value: number | null = null;
    if (blockedBy !== undefined) {
      result.errors[id] ??= `Waiting on "${blockedBy}", which cannot be scheduled`;
    } else {
      try {
        const work = parseDuration(node.workTime);
        value = ready + work;
        result.nodes[id] = { start: new Date(ready).toISOString(), completion: new Date(value).toISOString() };
        if (dependencyTime !== undefined) result.nodes[id].dependencyTime = new Date(dependencyTime).toISOString();
      } catch (error) {
        result.errors[id] = (error as Error).message;
      }
    }
    completion.set(id, value);
    return value;
  };

  for (const node of [...project.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) visit(node.id);
  return orderedSchedule(result, project);
}

/** Key results in id order so equal inputs give deeply equal outputs. */
function orderedSchedule(result: Schedule, project: Project): Schedule {
  const ids = project.nodes.map((n) => n.id).sort();
  const nodes: Schedule["nodes"] = {};
  const errors: Schedule["errors"] = {};
  for (const id of ids) {
    if (result.nodes[id]) nodes[id] = result.nodes[id];
    if (result.errors[id]) errors[id] = result.errors[id];
  }
  return { nodes, errors };
}
