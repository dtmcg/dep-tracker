import { parseDuration } from "./duration.ts";
import type { NodeFlag, Project, Schedule } from "./model.ts";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Strongly connected components (Tarjan, iterative, O(V+E)), in discovery order. */
function stronglyConnected(ids: string[], deps: Map<string, string[]>): string[][] {
  let index = 0;
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const root of ids) {
    if (indexOf.has(root)) continue;
    const work: { id: string; next: number }[] = [{ id: root, next: 0 }];
    indexOf.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work.at(-1)!;
      const neighbours = deps.get(frame.id) ?? [];
      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next++]!;
        if (!indexOf.has(w)) {
          indexOf.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, indexOf.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) === indexOf.get(frame.id)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.id);
        components.push(component.sort(byId));
      }
    }
  }
  return components;
}

/** Shortest closed path start → … → start inside a component, following "depends on" edges. */
function closedPath(start: string, members: Set<string>, deps: Map<string, string[]>): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of deps.get(id) ?? []) {
      if (!members.has(next)) continue;
      if (next === start) {
        const path = [start];
        for (let at = id; at !== start; at = previous.get(at)!) path.splice(1, 0, at);
        return [...path, start];
      }
      if (!previous.has(next)) {
        previous.set(next, id);
        queue.push(next);
      }
    }
  }
  return [start, start];
}

/**
 * Compute start and completion for every node.
 *
 * completion(n) = max(notBefore(n), dependencyTime(n)) + workTime(n), using the
 * project start only when neither applies; dependencyTime(n) is the latest
 * completion among n's direct dependencies. Nodes in a cycle, and nodes that
 * depend on one, get no dates (they are flagged instead). A node that cannot be
 * timed for another reason leaves its dependents untimed, with the reason in `errors`.
 */
export function schedule(project: Project): Schedule {
  const ids = project.nodes.map((n) => n.id).sort(byId);
  const nodeOf = new Map(project.nodes.map((n) => [n.id, n]));
  const titleOf = (id: string) => nodeOf.get(id)?.title ?? id;
  const deps = new Map<string, string[]>(ids.map((id) => [id, []]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of project.edges) {
    if (!nodeOf.has(e.dependentId) || !nodeOf.has(e.dependencyId)) continue;
    deps.get(e.dependentId)!.push(e.dependencyId);
    dependents.get(e.dependencyId)!.push(e.dependentId);
  }
  for (const list of [...deps.values(), ...dependents.values()]) list.sort(byId);

  const result: Schedule = { nodes: {}, errors: {}, flags: {}, cycles: [] };
  const flag = (id: string, f: NodeFlag) => (result.flags[id] ??= []).push(f);

  // Cycles: components with more than one node, or a node that depends on itself.
  const cyclic = new Map<string, string[]>(); // node → its cycle path
  const cycleComponents = stronglyConnected(ids, deps)
    .filter((c) => c.length > 1 || deps.get(c[0]!)!.includes(c[0]!))
    .sort((a, b) => byId(a[0]!, b[0]!));
  for (const component of cycleComponents) {
    const path = closedPath(component[0]!, new Set(component), deps);
    result.cycles.push(path);
    for (const id of component) cyclic.set(id, path);
  }

  // Everything that depends, directly or not, on a cyclic node is blocked.
  const blocked = new Map<string, string[]>(); // node → the cycle it waits on
  const queue = [...cyclic.keys()].sort(byId);
  while (queue.length) {
    const id = queue.shift()!;
    for (const d of dependents.get(id)!) {
      if (cyclic.has(d) || blocked.has(d)) continue;
      blocked.set(d, cyclic.get(id) ?? blocked.get(id)!);
      queue.push(d);
    }
  }

  // Orphans: not reachable from the success criteria.
  const reachable = new Set<string>();
  const walk = [project.rootId];
  while (walk.length) {
    const id = walk.pop()!;
    if (reachable.has(id) || !deps.has(id)) continue;
    reachable.add(id);
    walk.push(...deps.get(id)!);
  }

  const describe = (path: string[]) => path.map(titleOf).join(" → ");
  for (const id of ids) {
    if (cyclic.has(id)) {
      flag(id, "cyclic");
      result.errors[id] = `Part of a dependency cycle: ${describe(cyclic.get(id)!)}`;
    } else if (blocked.has(id)) {
      flag(id, "blockedByCycle");
      result.errors[id] = `Waiting on a dependency cycle: ${describe(blocked.get(id)!)}`;
    }
    if (!reachable.has(id)) flag(id, "orphan");
  }

  // Time everything else. No cycles remain among these nodes.
  const anchor = Date.parse(project.start);
  const completion = new Map<string, number | null>();
  const visit = (id: string): number | null => {
    if (completion.has(id)) return completion.get(id)!;
    if (cyclic.has(id) || blocked.has(id)) return null;
    const node = nodeOf.get(id)!;

    let dependencyTime: number | undefined;
    let waitingOn: string | undefined;
    for (const depId of deps.get(id)!) {
      const done = visit(depId);
      if (done === null) waitingOn ??= titleOf(depId);
      else dependencyTime = Math.max(dependencyTime ?? -Infinity, done);
    }
    const notBefore = node.notBefore ? Date.parse(node.notBefore) : undefined;
    // Project start applies only when there is neither a not-before date nor a dependency.
    const ready =
      notBefore === undefined && dependencyTime === undefined
        ? anchor
        : Math.max(notBefore ?? -Infinity, dependencyTime ?? -Infinity);

    let value: number | null = null;
    if (waitingOn !== undefined) {
      result.errors[id] = `Waiting on "${waitingOn}", which cannot be scheduled`;
    } else {
      try {
        value = ready + parseDuration(node.workTime);
        result.nodes[id] = { start: new Date(ready).toISOString(), completion: new Date(value).toISOString() };
        if (dependencyTime !== undefined) result.nodes[id].dependencyTime = new Date(dependencyTime).toISOString();
      } catch (error) {
        result.errors[id] = (error as Error).message;
      }
    }
    completion.set(id, value);
    return value;
  };
  for (const id of ids) visit(id);

  return ordered(result, ids);
}

/** Key results in id order so equal inputs give deeply equal outputs (NFR-9). */
function ordered(result: Schedule, ids: string[]): Schedule {
  const out: Schedule = { nodes: {}, errors: {}, flags: {}, cycles: result.cycles };
  for (const id of ids) {
    if (result.nodes[id]) out.nodes[id] = result.nodes[id];
    if (result.errors[id]) out.errors[id] = result.errors[id];
    if (result.flags[id]) out.flags[id] = result.flags[id];
  }
  return out;
}
