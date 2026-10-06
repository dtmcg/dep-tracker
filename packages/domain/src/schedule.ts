import { parseDuration } from "./duration.ts";
import type { ExternalTime, NodeFlag, Project, ProjectNode, Schedule } from "./model.ts";

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
 *
 * A reference node (`ref`) stands in for another project's success criteria: it
 * has no work time or dependencies of its own, and its completion is whatever
 * `externals[id]` says the other project's root completes at. A reference with
 * no usable answer is `unresolved` and blocks its dependents; one caught in a
 * loop of references between projects is `cyclic`, like a cycle inside this one.
 */
/** A node with no work time yet: it is shown, but adds nothing to the dates of what depends on it. */
const isUnestimated = (node: ProjectNode) => !node.ref && node.workTime.trim() === "";

export function schedule(project: Project, externals: Record<string, ExternalTime> = {}): Schedule {
  const ids = project.nodes.map((n) => n.id).sort(byId);
  const nodeOf = new Map(project.nodes.map((n) => [n.id, n]));
  const titleOf = (id: string) => nodeOf.get(id)?.title ?? id;
  const deps = new Map<string, string[]>(ids.map((id) => [id, []]));
  const dependents = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of project.edges) {
    if (!nodeOf.has(e.dependentId) || !nodeOf.has(e.dependencyId)) continue;
    if (nodeOf.get(e.dependentId)!.ref) continue; // a reference has no dependencies of its own
    deps.get(e.dependentId)!.push(e.dependencyId);
    dependents.get(e.dependencyId)!.push(e.dependentId);
  }
  for (const list of [...deps.values(), ...dependents.values()]) list.sort(byId);

  const result: Schedule = { nodes: {}, errors: {}, flags: {}, cycles: [], projectCycles: [] };
  const flag = (id: string, f: NodeFlag) => (result.flags[id] ??= []).push(f);

  // Cycles: components with more than one node, or a node that depends on itself.
  const describe = (path: string[]) => path.map(titleOf).join(" → ");
  const cyclic = new Map<string, string>(); // node → its cycle, as text
  const cycleComponents = stronglyConnected(ids, deps)
    .filter((c) => c.length > 1 || deps.get(c[0]!)!.includes(c[0]!))
    .sort((a, b) => byId(a[0]!, b[0]!));
  for (const component of cycleComponents) {
    const path = closedPath(component[0]!, new Set(component), deps);
    result.cycles.push(path);
    for (const id of component) cyclic.set(id, describe(path));
  }
  // References caught in a loop of projects are cyclic too.
  const references = ids.filter((id) => nodeOf.get(id)!.ref);
  const unresolved = new Map<string, string>(); // reference → why it can't be timed
  for (const id of references) {
    const external = externals[id];
    if (external && "error" in external && external.cycle) {
      cyclic.set(id, external.cycle.join(" → "));
      result.projectCycles.push({ nodeId: id, path: external.cycle });
    } else if (!external) unresolved.set(id, "This reference has not been resolved yet");
    else if ("error" in external) unresolved.set(id, external.error);
    else if (Number.isNaN(Date.parse(external.completion))) unresolved.set(id, `"${external.completion}" is not a valid completion time`);
  }

  // Everything that depends, directly or not, on a cyclic node is blocked.
  const blocked = new Map<string, string>(); // node → the cycle it waits on, as text
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

  // Everything that depends on an unresolved reference waits for it too.
  const waitingOnReference = new Map<string, string>(); // node → title of the reference it waits on
  const refQueue = [...unresolved.keys()].filter((id) => !cyclic.has(id)).sort(byId);
  while (refQueue.length) {
    const id = refQueue.shift()!;
    for (const d of dependents.get(id)!) {
      if (cyclic.has(d) || blocked.has(d) || unresolved.has(d) || waitingOnReference.has(d)) continue;
      waitingOnReference.set(d, waitingOnReference.get(id) ?? titleOf(id));
      refQueue.push(d);
    }
  }

  for (const id of ids) {
    if (cyclic.has(id)) {
      flag(id, "cyclic");
      result.errors[id] = `Part of a dependency cycle: ${cyclic.get(id)}`;
    } else if (blocked.has(id)) {
      flag(id, "blockedByCycle");
      result.errors[id] = `Waiting on a dependency cycle: ${blocked.get(id)}`;
    } else if (unresolved.has(id)) {
      flag(id, "unresolved");
      result.errors[id] = unresolved.get(id)!;
    } else if (waitingOnReference.has(id)) {
      flag(id, "blockedByReference");
      result.errors[id] = `Waiting on "${waitingOnReference.get(id)}", a reference that can't be resolved`;
    }
    if (!reachable.has(id)) flag(id, "orphan");
    if (isUnestimated(nodeOf.get(id)!)) flag(id, "unestimated");
  }

  // Time everything else. No cycles remain among these nodes.
  const anchor = Date.parse(project.start);
  const completion = new Map<string, number | null>();
  const visit = (id: string): number | null => {
    if (completion.has(id)) return completion.get(id)!;
    if (cyclic.has(id) || blocked.has(id) || unresolved.has(id) || waitingOnReference.has(id)) return null;
    const node = nodeOf.get(id)!;

    if (node.ref) {
      // Its time is the other project's; the server resolved it (a failure was handled above).
      const completionTime = (externals[id] as { completion: string }).completion;
      const ms = Date.parse(completionTime);
      const iso = new Date(ms).toISOString();
      result.nodes[id] = { start: iso, completion: iso };
      completion.set(id, ms);
      return ms;
    }

    let dependencyTime: number | undefined;
    let waitingOn: string | undefined;
    for (const depId of deps.get(id)!) {
      const done = visit(depId);
      if (isUnestimated(nodeOf.get(depId)!)) continue; // keeps its own placeholder date, but doesn't hold anything up
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
        value = ready + (isUnestimated(node) ? 0 : parseDuration(node.workTime));
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
  const out: Schedule = {
    nodes: {},
    errors: {},
    flags: {},
    cycles: result.cycles,
    projectCycles: [...result.projectCycles].sort((a, b) => byId(a.nodeId, b.nodeId)),
  };
  for (const id of ids) {
    if (result.nodes[id]) out.nodes[id] = result.nodes[id];
    if (result.errors[id]) out.errors[id] = result.errors[id];
    if (result.flags[id]) out.flags[id] = result.flags[id];
  }
  return out;
}
