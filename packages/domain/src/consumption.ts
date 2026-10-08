import { formatDuration, parseDuration } from "./duration.ts";
import type { Project, ProjectNode, Resource } from "./model.ts";

/**
 * Resource consumption. Allocating several resources to a work item does not change its duration, and each
 * allocated resource is used for the item's whole work time: Developer x 2 on a 3d item consumes 3d from each
 * developer, 6d in all.
 */
export interface RequirementConsumption {
  typeName: string;
  count: number;
  /** Time each allocated resource is used: the item's work time. Null when the item has no work time yet. */
  eachMs: number | null;
  /** count x eachMs; null when the item has no work time yet. */
  totalMs: number | null;
}

const workMs = (node: ProjectNode): number | null => (node.workTime.trim() ? parseDuration(node.workTime) : null);

/** What one work item consumes, per resource type it needs. */
export function nodeConsumption(node: ProjectNode): RequirementConsumption[] {
  const each = node.ref ? null : workMs(node);
  return (node.resources ?? []).map((r) => ({
    typeName: r.typeName,
    count: r.count,
    eachMs: each,
    totalMs: each === null ? null : each * r.count,
  }));
}

export interface TypeConsumption {
  typeName: string;
  /** Resource time the project's work items consume of this type. */
  totalMs: number;
  /** Work items that need this type. */
  items: number;
  /** Of those, how many have no work time yet and so add nothing. */
  unestimated: number;
}

/** What the whole project consumes of each type in its pool (types nobody needs are listed with zero). */
export function projectConsumption(project: Project): TypeConsumption[] {
  const byType = new Map<string, TypeConsumption>(
    (project.resourceTypes ?? []).map((t) => [t.name, { typeName: t.name, totalMs: 0, items: 0, unestimated: 0 }]),
  );
  for (const node of project.nodes) {
    for (const c of nodeConsumption(node)) {
      const entry = byType.get(c.typeName);
      if (!entry) continue;
      entry.items += 1;
      if (c.totalMs === null) entry.unestimated += 1;
      else entry.totalMs += c.totalMs;
    }
  }
  return [...byType.values()];
}

/** "3d each, 6d in all", or a note when there is no work time to count. */
export function describeConsumption(c: RequirementConsumption): string {
  if (c.eachMs === null) return "no work time yet";
  return c.count === 1 ? `${formatDuration(c.eachMs)}` : `${formatDuration(c.eachMs)} each, ${formatDuration(c.totalMs!)} in all`;
}

/** How much working time a resource has, in ms. Null means continuously available (no available time given), i.e. no limit. */
export function availableMs(resource: Resource): number | null {
  return resource.available.trim() ? parseDuration(resource.available) : null;
}

/** "40h", or "always available" for a resource with no available time. */
export function describeAvailability(resource: Resource): string {
  return resource.available.trim() || "always available";
}
