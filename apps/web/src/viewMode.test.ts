import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VIEW, loadTimeScale, loadView, saveTimeScale, saveView, VIEWS } from "./viewMode.ts";

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
};

describe("view mode", () => {
  it("offers the time line view and the node view, time line first", () => {
    assert.deepEqual(VIEWS.map((v) => v.id), ["timeline", "nodes"]);
    assert.deepEqual(VIEWS.map((v) => v.name), ["Time line view", "Node view"]);
    assert.equal(DEFAULT_VIEW, "timeline");
  });

  it("starts on the time line view", () => {
    assert.equal(loadView(memory()), "timeline");
  });

  it("remembers the choice", () => {
    const store = memory();
    saveView(store, "nodes");
    assert.equal(loadView(store), "nodes");
  });

  it("ignores a stored value it doesn't know", () => {
    assert.equal(loadView(memory({ "dep-tracker.view": "radar" })), "timeline");
  });

  it("carries on when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    };
    assert.equal(loadView(blocked), "timeline");
    assert.doesNotThrow(() => saveView(blocked, "nodes"));
  });
});

describe("time scale", () => {
  it("is on until switched off", () => {
    assert.equal(loadTimeScale(memory()), true);
  });

  it("remembers the choice", () => {
    const store = memory();
    saveTimeScale(store, false);
    assert.equal(loadTimeScale(store), false);
    saveTimeScale(store, true);
    assert.equal(loadTimeScale(store), true);
  });

  it("copes with storage that throws", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    assert.equal(loadTimeScale(broken), true);
    assert.doesNotThrow(() => saveTimeScale(broken, false));
  });
});
