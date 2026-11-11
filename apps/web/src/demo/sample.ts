import type { Project, ProjectNode } from "@dep-tracker/domain";

const node = (id: string, title: string, workTime: string, extra: Partial<ProjectNode> = {}): ProjectNode => ({
  id,
  title,
  workTime,
  labels: [],
  description: "",
  links: [],
  ...extra,
});

/**
 * The project the online demo opens: a small app release with labels, a not-before date, an item with no work
 * time yet, and a resource pool with requirements, so each feature has something to show.
 */
export function sampleProject(): Project {
  return {
    id: "demo",
    name: "Mobile relaunch",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "launch",
    nodes: [
      node("launch", "Public beta live", "2d", {
        labels: ["milestone"],
        description: "Beta opens to all sign-ups, with the feedback widget switched on.",
        links: ["https://example.com/beta"],
        resources: [{ typeName: "Developer", count: 1, min: 1, max: 2 }],
      }),
      node("qa", "QA sign-off", "3d", {
        labels: ["team:qa"],
        description: "Full regression pass on iOS and Android.",
        resources: [{ typeName: "Tester", count: 2, min: 1, max: 3 }],
      }),
      node("build", "Build release candidate", "4d", {
        labels: ["team:web", "risk"],
        description: "Freeze the branch, then build and sign both apps.",
        resources: [{ typeName: "Developer", count: 2, min: 1, max: 3 }],
      }),
      node("api", "New sign-up API", "5d", { labels: ["team:web", "risk"], resources: [{ typeName: "Developer", count: 2 }] }),
      node("ui", "Sign-up screens", "6d", { labels: ["team:web"], resources: [{ typeName: "Designer", count: 1 }, { typeName: "Developer", count: 1 }] }),
      node("legal", "Privacy review", "", { labels: ["team:legal"], description: "No estimate yet, so it is ignored in the dates (and flagged)." }),
      node("copy", "Store listing copy", "2d", { labels: ["team:marketing"], notBefore: "2026-11-09T09:00:00.000Z", description: "Can't start before the marketing brief lands on 9 Nov." }),
      node("design", "Design system update", "3d", { labels: ["team:design"], resources: [{ typeName: "Designer", count: 1, min: 1 }] }),
    ],
    edges: [
      { dependentId: "launch", dependencyId: "qa" },
      { dependentId: "launch", dependencyId: "copy" },
      { dependentId: "launch", dependencyId: "legal" },
      { dependentId: "qa", dependencyId: "build" },
      { dependentId: "build", dependencyId: "api" },
      { dependentId: "build", dependencyId: "ui" },
      { dependentId: "ui", dependencyId: "design" },
    ],
    labelColours: { milestone: "#7c3aed", risk: "#dc2626", "team:web": "#2563eb", "team:design": "#db2777", "team:qa": "#16a34a" },
    resourceTypes: [
      {
        name: "Developer",
        resources: [
          { id: "r-dev-1", name: "Ann", available: "20d" },
          { id: "r-dev-2", name: "Bob", available: "" },
          { id: "r-dev-3", name: "Cy", available: "10d" },
        ],
      },
      { name: "Designer", resources: [{ id: "r-des-1", name: "Dee", available: "15d" }] },
      { name: "Tester", resources: [{ id: "r-test-1", name: "", available: "" }, { id: "r-test-2", name: "Eve", available: "8d" }] },
    ],
  };
}
