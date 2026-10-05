import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNote, writeNote } from "./frontmatter.ts";

describe("parseNote", () => {
  it("reads scalars, block and flow lists, and a nested map", () => {
    const note = parseNote(`---
id: n02
work_time: 1w
title: "Payments: phase 2"
quoted: 'it''s'
depends_on:
  - "[[API contract agreed]]"
  - "[[Docs, final]]"
tags: [team/platform, risk]
label_colours:
  risk: "#cc0000"
  team/web: "#0b7f73"
empty:
---
Integrate the payment provider.

Second paragraph.
`);
    assert.equal(note.data.id, "n02");
    assert.equal(note.data.work_time, "1w");
    assert.equal(note.data.title, "Payments: phase 2");
    assert.equal(note.data.quoted, "it's");
    assert.deepEqual(note.data.depends_on, ["[[API contract agreed]]", "[[Docs, final]]"]);
    assert.deepEqual(note.data.tags, ["team/platform", "risk"]);
    assert.deepEqual(note.data.label_colours, { risk: "#cc0000", "team/web": "#0b7f73" });
    assert.equal(note.data.empty, null);
    assert.equal(note.body, "Integrate the payment provider.\n\nSecond paragraph.\n");
  });

  it("treats a note without frontmatter as all body", () => {
    const note = parseNote("Just text\n");
    assert.deepEqual(note.data, {});
    assert.equal(note.body, "Just text\n");
  });

  it("accepts Windows line endings", () => {
    const note = parseNote("---\r\nid: n1\r\ntags:\r\n  - a\r\n---\r\nBody\r\n");
    assert.equal(note.data.id, "n1");
    assert.deepEqual(note.data.tags, ["a"]);
    assert.equal(note.body, "Body\r\n");
  });
});

describe("writeNote", () => {
  it("round-trips through parseNote, quoting strings that need it", () => {
    const data = {
      id: "n02",
      title: 'Has: colon, "quotes" and # hash',
      depends_on: ["[[A]]", "[[B, c]]"],
      tags: [],
      label_colours: { risk: "#cc0000", "team:web": "#0b7f73" },
      count: "3",
    };
    const text = writeNote(data, "Body text\n");
    const parsed = parseNote(text);
    assert.deepEqual(parsed.data, data);
    assert.equal(parsed.body, "Body text\n");
    assert.match(text, /^---\nid: n02\n/);
  });

  it("keeps keys it does not own, as written, in their place", () => {
    const original = "---\nid: n1\nstatus: draft   # my note\nwork_time: 1d\ncustom:\n  nested: yes\n---\nBody\n";
    const { raw } = parseNote(original);
    const text = writeNote({ id: "n1", work_time: "2d" }, "Body\n", raw);
    assert.equal(text, "---\nid: n1\nstatus: draft   # my note\nwork_time: 2d\ncustom:\n  nested: yes\n---\nBody\n");
  });
});
