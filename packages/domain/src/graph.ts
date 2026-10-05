import type { Project, Schedule } from "./model.ts";

function walk(project: Project, start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...next(start)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return seen;
}

/** Every node `id` depends on, directly or not (upstream). */
export function dependenciesOf(project: Project, id: string): Set<string> {
  return walk(project, id, (n) => project.edges.filter((e) => e.dependentId === n).map((e) => e.dependencyId));
}

/** Every node that depends on `id`, directly or not (downstream). */
export function dependentsOf(project: Project, id: string): Set<string> {
  return walk(project, id, (n) => project.edges.filter((e) => e.dependencyId === n).map((e) => e.dependentId));
}

/**
 * Edges ("dependencyId>dependentId") on the critical chain into `id` (FR-16):
 * from each node, the dependencies whose completion set its start. The chain
 * stops at a node whose not-before date, rather than a dependency, sets its start.
 */
export function criticalEdges(project: Project, sched: Schedule, id: string): Set<string> {
  const edges = new Set<string>();
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    const times = sched.nodes[node];
    if (!times?.dependencyTime || times.start !== times.dependencyTime) continue;
    for (const e of project.edges) {
      if (e.dependentId !== node) continue;
      if (sched.nodes[e.dependencyId]?.completion === times.dependencyTime) {
        edges.add(`${e.dependencyId}>${node}`);
        stack.push(e.dependencyId);
      }
    }
  }
  return edges;
}
