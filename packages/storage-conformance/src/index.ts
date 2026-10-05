import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Project,
  ProjectExistsError,
  type StorageAdapter,
  type StorageDescriptor,
  VersionConflictError,
} from "@dep-tracker/domain";

/**
 * The shared conformance suite (PRD: "Every adapter runs the same suite").
 * Each adapter's test file calls this with a harness for its store.
 */
export interface ConformanceHarness<D extends StorageDescriptor> {
  adapter: StorageAdapter<D>;
  /** A location with no project in it yet. */
  freshDescriptor(): Promise<D>;
  /** Change the stored project the way a person editing the store by hand would. */
  editExternally(descriptor: D): Promise<void>;
}

/** A project exercising every field and the awkward characters stores must survive. */
export function richProject(): Project {
  return {
    id: "p-conformance",
    name: "Launch, \"v2\" — ünïcode",
    start: "2026-11-02T09:00:00.000Z",
    rootId: "n01",
    nodes: [
      {
        id: "n01",
        title: "Public beta live",
        workTime: "2d",
        labels: ["risk", "team:web"],
        description: "Beta open to all sign-ups.\nLine two, with a comma and \"quotes\".",
        links: ["https://example.com/beta", "https://example.com/beta-notes"],
      },
      {
        id: "n02",
        title: "Payments integration",
        workTime: "1w 2d",
        notBefore: "2026-11-03T00:00:00.000Z",
        labels: ["team:platform"],
        description: "",
        links: [],
      },
      { id: "n03", title: "API contract agreed", workTime: "4h", labels: [], description: "Signed off by both teams", links: [] },
    ],
    edges: [
      { dependentId: "n01", dependencyId: "n02" },
      { dependentId: "n02", dependencyId: "n03" },
    ],
  };
}

/** Compare projects ignoring the order nodes and edges are stored in. */
export function normalised(project: Project): Project {
  const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    ...project,
    nodes: [...project.nodes].sort((a, b) => byText(a.id, b.id)),
    edges: [...project.edges].sort((a, b) =>
      byText(`${a.dependentId}>${a.dependencyId}`, `${b.dependentId}>${b.dependencyId}`),
    ),
  };
}

export function describeStorageAdapter<D extends StorageDescriptor>(name: string, harness: ConformanceHarness<D>): void {
  const { adapter } = harness;

  describe(`${name}: storage conformance`, () => {
    it("creates a project that loads back unchanged", async () => {
      const d = await harness.freshDescriptor();
      const version = await adapter.create(d, richProject());
      const loaded = await adapter.load(d);
      assert.deepEqual(normalised(loaded.project), normalised(richProject()));
      assert.equal(loaded.version, version);
    });

    it("refuses to create over an existing project", async () => {
      const d = await harness.freshDescriptor();
      await adapter.create(d, richProject());
      await assert.rejects(adapter.create(d, richProject()), ProjectExistsError);
    });

    it("saves changes and returns a new version", async () => {
      const d = await harness.freshDescriptor();
      const v1 = await adapter.create(d, richProject());
      const changed: Project = {
        ...richProject(),
        nodes: [
          ...richProject().nodes,
          { id: "n04", title: "Docs, \"final\"", workTime: "1d", labels: [], description: "", links: [] },
        ],
        edges: [...richProject().edges, { dependentId: "n01", dependencyId: "n04" }],
      };
      const v2 = await adapter.save(d, changed, v1);
      assert.notEqual(v2, v1);
      const loaded = await adapter.load(d);
      assert.deepEqual(normalised(loaded.project), normalised(changed));
      assert.equal(loaded.version, v2);
    });

    it("rejects a save based on a stale version and keeps the stored project", async () => {
      const d = await harness.freshDescriptor();
      const v1 = await adapter.create(d, richProject());
      await harness.editExternally(d);
      const afterEdit = await adapter.load(d);
      await assert.rejects(adapter.save(d, richProject(), v1), VersionConflictError);
      assert.deepEqual(await adapter.load(d), afterEdit);
    });

    it("reports a version that changes when the store is edited outside the app", async () => {
      const d = await harness.freshDescriptor();
      const v1 = await adapter.create(d, richProject());
      assert.equal(await adapter.version(d), v1);
      await harness.editExternally(d);
      const v2 = await adapter.version(d);
      assert.notEqual(v2, v1);
      assert.equal((await adapter.load(d)).version, v2);
    });

    it("load then save without edits changes nothing (NFR-4)", async () => {
      const d = await harness.freshDescriptor();
      await adapter.create(d, richProject());
      const first = await adapter.load(d);
      await adapter.save(d, first.project, first.version);
      const second = await adapter.load(d);
      assert.deepEqual(normalised(second.project), normalised(first.project));
    });

    it("fails to load a location with no project", async () => {
      const d = await harness.freshDescriptor();
      await assert.rejects(adapter.load(d));
    });
  });
}
