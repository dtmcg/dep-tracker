import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Project, ProjectExistsError } from "@dep-tracker/domain";
import { richProject } from "@dep-tracker/storage-conformance";
import { createGoogleSheetsAdapter, GoogleSheetsError, spreadsheetId } from "./adapter.ts";
import { createSheetsClient } from "./client.ts";
import { type FakeGoogle, startFakeGoogle } from "./fake-google.ts";
import { dateToSerial } from "./timezone.ts";

let fake: FakeGoogle;
let token = "";
before(async () => {
  fake = await startFakeGoogle({ clientId: "cid", clientSecret: "secret" });
  token = ((await (await fetch(`${fake.url}/__admin/tokens`)).json()) as { access_token: string }).access_token;
});
after(() => fake.close());

const adapter = () => createGoogleSheetsAdapter(createSheetsClient({ baseUrl: async () => fake.url, accessToken: async () => token }));
const descriptor = (id: string) => ({ kind: "gsheets" as const, path: id });
const sheet = (id: string, title: string) => fake.spreadsheet(id)!.sheets.find((s) => s.title === title)!;

describe("spreadsheetId", () => {
  it("accepts a sheet's URL or its bare id", () => {
    assert.equal(spreadsheetId("https://docs.google.com/spreadsheets/d/1AbC-_9/edit#gid=0"), "1AbC-_9");
    assert.equal(spreadsheetId("1AbC-_9"), "1AbC-_9");
    assert.throws(() => spreadsheetId("https://example.com/nope"), /spreadsheet link/i);
  });
});

describe("googleSheetsAdapter", () => {
  it("turns a blank spreadsheet's Sheet1 into Project and adds Tasks and Labels", async () => {
    const id = fake.createSpreadsheet("Blank");
    await adapter().create(descriptor(id), richProject());
    assert.deepEqual(fake.spreadsheet(id)!.sheets.map((s) => s.title), ["Project", "Tasks", "Labels"]);
  });

  it("stores dates as serial numbers in the spreadsheet's time zone", async () => {
    const id = fake.createSpreadsheet("NY", "America/New_York");
    await adapter().create(descriptor(id), richProject());
    const start = sheet(id, "Project").grid.find((r) => r[0] === "Start")![1];
    assert.equal(start, dateToSerial(new Date(richProject().start), "America/New_York"));
    const { project } = await adapter().load(descriptor(id));
    assert.equal(project.start, richProject().start);
  });

  it("writes text exactly, so a title that looks like a formula stays text", async () => {
    const p: Project = { ...richProject(), nodes: richProject().nodes.map((n) => (n.id === "n03" ? { ...n, title: "=1+1" } : n)) };
    const id = fake.createSpreadsheet("Formula");
    await adapter().create(descriptor(id), p);
    assert.ok(sheet(id, "Tasks").grid.some((r) => r[1] === "=1+1"));
    const { project } = await adapter().load(descriptor(id));
    assert.equal(project.nodes.find((n) => n.id === "n03")!.title, "=1+1");
  });

  it("formats the sheets for people: bold frozen header, date formats, label colours", async () => {
    const id = fake.createSpreadsheet("Formats");
    await adapter().create(descriptor(id), richProject());
    const tasks = sheet(id, "Tasks");
    assert.equal(tasks.frozenRows, 1);
    const formats = JSON.stringify(tasks.formats);
    assert.match(formats, /"bold":true/);
    assert.match(formats, /"type":"DATE_TIME","pattern":"yyyy-mm-dd hh:mm"/);
    assert.match(JSON.stringify(sheet(id, "Labels").formats), /"backgroundColor":\{"red":0\.8,"green":0,"blue":0\}/);
  });

  it("refuses to create over a spreadsheet that already holds a project", async () => {
    const id = fake.createSpreadsheet("Taken");
    await adapter().create(descriptor(id), richProject());
    await assert.rejects(adapter().create(descriptor(id), richProject()), ProjectExistsError);
  });

  it("clears rows of deleted tasks and keeps the user's other sheets and columns", async () => {
    const id = fake.createSpreadsheet("Edits");
    await adapter().create(descriptor(id), richProject());
    // A person adds their own sheet and column
    fake.spreadsheet(id)!.sheets.push({ sheetId: 77, title: "Notes", grid: [["keep me"]], frozenRows: 0, formats: [] });
    const tasks = sheet(id, "Tasks");
    const ownerCol = tasks.grid[0]!.length;
    fake.setCell(id, "Tasks", 0, ownerCol, "Owner");
    fake.setCell(id, "Tasks", 1, ownerCol, "Aoife");

    const { project, version } = await adapter().load(descriptor(id));
    const fewer = { ...project, nodes: project.nodes.filter((n) => n.id !== "n03"), edges: project.edges.filter((e) => e.dependencyId !== "n03") };
    await adapter().save(descriptor(id), fewer, version);

    const after = sheet(id, "Tasks").grid;
    const titles = after.map((r) => r[1]).filter((t) => t !== null && t !== undefined);
    assert.deepEqual(titles, ["Title", "Public beta live", "Payments integration", "Partner API"]);
    assert.equal(after[1]![after[0]!.indexOf("Owner")], "Aoife");
    assert.equal(sheet(id, "Notes").grid[0]![0], "keep me");
  });

  it("explains when Google rejects the sign-in", async () => {
    const id = fake.createSpreadsheet("Denied");
    const denied = createGoogleSheetsAdapter(createSheetsClient({ baseUrl: async () => fake.url, accessToken: async () => "expired" }));
    await assert.rejects(denied.load(descriptor(id)), (e: unknown) => e instanceof GoogleSheetsError && /sign in/i.test(e.message));
  });

  it("explains a spreadsheet that doesn't exist or isn't shared", async () => {
    await assert.rejects(adapter().load(descriptor("missing")), /not found|access/i);
  });
});

describe("googleSheetsAdapter: a task renamed in the browser", () => {
  it("keeps the dependencies that still name it by its old title, then rewrites them on save", async () => {
    const id = fake.createSpreadsheet("Rename");
    const sheets = adapter();
    await sheets.create(descriptor(id), richProject());
    await sheets.load(descriptor(id));
    const tasks = sheet(id, "Tasks");
    const header = tasks.grid[0]!;
    const row = tasks.grid.findIndex((r) => r[header.indexOf("Title")] === "API contract agreed");
    fake.setCell(id, "Tasks", row, header.indexOf("Title"), "Contract signed");

    const { project, version } = await sheets.load(descriptor(id));
    assert.equal(project.nodes.find((n) => n.id === "n03")!.title, "Contract signed");
    assert.ok(project.edges.some((e) => e.dependentId === "n02" && e.dependencyId === "n03"));

    await sheets.save(descriptor(id), project, version);
    const payments = sheet(id, "Tasks").grid.find((r) => r[header.indexOf("Title")] === "Payments integration")!;
    assert.equal(payments[header.indexOf("Depends on")], "Contract signed");
  });
});
