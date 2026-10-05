import { parseDuration } from "./duration.ts";
import type { Project, Schedule } from "./model.ts";

/**
 * Compute start and completion for every node.
 *
 * completion(n) = max(notBefore(n), dependencyTime(n)) + workTime(n), falling
 * back to the project start when neither applies. Slice S0 covers nodes
 * without dependencies; dependency time and cycles arrive in S1, S2 and S4.
 */
export function schedule(project: Project): Schedule {
  const result: Schedule = { nodes: {}, errors: {} };
  const anchor = Date.parse(project.start);

  for (const node of project.nodes) {
    let workMs: number;
    try {
      workMs = parseDuration(node.workTime);
    } catch (error) {
      result.errors[node.id] = (error as Error).message;
      continue;
    }
    result.nodes[node.id] = {
      start: new Date(anchor).toISOString(),
      completion: new Date(anchor + workMs).toISOString(),
    };
  }

  return result;
}
