import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultProjectsDir, resourcingEnabled } from "./config.ts";

describe("defaultProjectsDir", () => {
  it("is pdm_projects under Documents in the Windows home folder", () => {
    assert.equal(defaultProjectsDir("C:\\Users\\Calculon", "win32"), "C:\\Users\\Calculon\\Documents\\pdm_projects");
  });

  it("is pdm_projects under Documents in the macOS home folder", () => {
    assert.equal(defaultProjectsDir("/Users/dan", "darwin"), "/Users/dan/Documents/pdm_projects");
  });

  it("does the same on Linux", () => {
    assert.equal(defaultProjectsDir("/home/dan", "linux"), "/home/dan/Documents/pdm_projects");
  });

  it("lets DEP_TRACKER_PROJECTS_DIR override it", () => {
    assert.equal(defaultProjectsDir("/home/dan", "linux", "/data/plans"), "/data/plans");
  });
});

describe("resourcingEnabled", () => {
  it("is off by default", () => {
    assert.equal(resourcingEnabled(["node", "main.ts"]), false);
  });

  it("is switched on by --resourcing on the command line", () => {
    assert.equal(resourcingEnabled(["node", "main.ts", "--resourcing"]), true);
  });

  it("ignores other arguments", () => {
    assert.equal(resourcingEnabled(["node", "main.ts", "--resource", "resourcing"]), false);
  });
});
