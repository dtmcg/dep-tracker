import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectNode } from "@dep-tracker/domain";
import { formChanges, fromLocalInput, toForm, toLocalInput } from "./nodeForm.ts";

const node: ProjectNode = {
  id: "n01",
  title: "Release",
  workTime: "2d",
  notBefore: "2026-11-05T09:00:00.000Z",
  labels: ["risk"],
  description: "Notes",
  links: ["https://a.test", "https://b.test"],
};

describe("datetime-local conversion", () => {
  it("round-trips through the browser's local time", () => {
    assert.equal(fromLocalInput(toLocalInput("2026-11-05T09:00:00.000Z")), "2026-11-05T09:00:00.000Z");
    assert.equal(fromLocalInput(""), null);
  });
});

describe("node form", () => {
  it("starts from the node's values with links one per line", () => {
    const form = toForm(node);
    assert.equal(form.title, "Release");
    assert.equal(form.links, "https://a.test\nhttps://b.test");
    assert.equal(fromLocalInput(form.notBefore), "2026-11-05T09:00:00.000Z");
  });

  it("produces only the fields that changed", () => {
    const form = { ...toForm(node), title: "Release v2", links: "https://a.test\n\n https://c.test " };
    const { changes, errors } = formChanges(node, form);
    assert.deepEqual(errors, {});
    assert.deepEqual(changes, { title: "Release v2", links: ["https://a.test", "https://c.test"] });
  });

  it("clears the not-before date when the field is emptied", () => {
    const { changes } = formChanges(node, { ...toForm(node), notBefore: "" });
    assert.deepEqual(changes, { notBefore: null });
  });

  it("reports each invalid field", () => {
    const { errors } = formChanges(node, { ...toForm(node), title: " ", workTime: "2x" });
    assert.match(errors.title ?? "", /title/i);
    assert.match(errors.workTime ?? "", /"2x"/);
  });
});

describe("node form for a reference", () => {
  const ref: ProjectNode = {
    id: "n05",
    title: "Partner API",
    workTime: "0m",
    labels: [],
    description: "",
    links: [],
    ref: { storage: { kind: "excel", path: "C:\\plans\\partner.xlsx" } },
  };

  it("shows where the reference points", () => {
    assert.equal(toForm(ref).reference, "excel:C:\\plans\\partner.xlsx");
    assert.equal(toForm(node).reference, "");
  });

  it("ignores work time and not-before, which belong to the other project", () => {
    const { changes, errors } = formChanges(ref, { ...toForm(ref), workTime: "garbage", notBefore: "2026-11-05T09:00" });
    assert.deepEqual(errors, {});
    assert.deepEqual(changes, {});
  });

  it("retargets a reference", () => {
    const { changes, errors } = formChanges(ref, { ...toForm(ref), reference: "csv:/plans/partner" });
    assert.deepEqual(errors, {});
    assert.deepEqual(changes, { ref: { storage: { kind: "csv", path: "/plans/partner" } } });
  });

  it("says what is wrong with a reference", () => {
    const { errors } = formChanges(ref, { ...toForm(ref), reference: "word:/x" });
    assert.match(errors.reference ?? "", /csv, excel, obsidian, gsheets/);
  });
});
