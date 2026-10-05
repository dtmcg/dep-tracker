import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Command } from "@dep-tracker/domain";
import { emptyHistory, record, redoStep, undoStep } from "./history.ts";

const fwd = (n: number): Command[] => [{ type: "removeNode", id: `f${n}` }];
const inv = (n: number): Command[] => [{ type: "removeNode", id: `i${n}` }];

describe("undo history", () => {
  it("undoes the latest step first and can redo it", () => {
    let h = record(record(emptyHistory, fwd(1), inv(1)), fwd(2), inv(2));
    const u = undoStep(h)!;
    assert.deepEqual(u.commands, inv(2));
    h = u.history;
    const r = redoStep(h)!;
    assert.deepEqual(r.commands, fwd(2));
  });

  it("clears redo when a new edit is recorded", () => {
    let h = record(emptyHistory, fwd(1), inv(1));
    h = undoStep(h)!.history;
    h = record(h, fwd(3), inv(3));
    assert.equal(redoStep(h), null);
  });

  it("returns null when there is nothing to undo or redo", () => {
    assert.equal(undoStep(emptyHistory), null);
    assert.equal(redoStep(emptyHistory), null);
  });

  it("keeps at most 100 steps", () => {
    let h = emptyHistory;
    for (let i = 0; i < 150; i++) h = record(h, fwd(i), inv(i));
    assert.equal(h.undo.length, 100);
  });
});
