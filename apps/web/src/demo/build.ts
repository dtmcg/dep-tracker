import type { Project, ProjectNode, ResourceType } from "@dep-tracker/domain";

/** Small helpers so the example projects read as data rather than boilerplate. */
export const item = (id: string, title: string, workTime: string, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id,
  title,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...extra,
});

/** A node standing in for another project's success criteria. `path` is where the other example project lives. */
export const reference = (id: string, title: string, path: string, extra: Partial<ProjectNode> = {}): ProjectNode =>
  item(id, title, "0m", { ...extra, ref: { storage: { kind: "csv", path } } });

/** "a needs b and c" as dependency edges: `needs("a", "b", "c")`. */
export const needs = (dependentId: string, ...dependencyIds: string[]) =>
  dependencyIds.map((dependencyId) => ({ dependentId, dependencyId }));

export const pool = (name: string, people: [name: string, available: string][]): ResourceType => ({
  name,
  resources: people.map(([who, available], i) => ({ id: `${name.toLowerCase().replace(/\W+/g, "-")}-${i + 1}`, name: who, available })),
});

export type { Project };
