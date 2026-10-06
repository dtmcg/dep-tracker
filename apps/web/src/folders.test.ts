import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectsFolderPrefix, suggestFolder } from "./folders.ts";

describe("suggestFolder", () => {
  it("puts a new project in its own folder under the projects folder", () => {
    assert.equal(suggestFolder("C:\\Users\\Calculon\\Documents\\pdm_projects", "Mobile relaunch"), "C:\\Users\\Calculon\\Documents\\pdm_projects\\Mobile relaunch");
    assert.equal(suggestFolder("/Users/dan/Documents/pdm_projects", "Mobile relaunch"), "/Users/dan/Documents/pdm_projects/Mobile relaunch");
  });

  it("drops characters that can't be in a folder name and tidies spaces", () => {
    assert.equal(suggestFolder("/p", '  Q4: plan/v2?  '), "/p/Q4 planv2");
  });

  it("offers just the projects folder while there is no name", () => {
    assert.equal(suggestFolder("/p", "  "), "/p/");
    assert.equal(suggestFolder("C:\\p", ""), "C:\\p\\");
  });

  it("is empty when the projects folder isn't known", () => {
    assert.equal(suggestFolder("", "Plan"), "");
  });
});

describe("projectsFolderPrefix", () => {
  it("ends with the separator the path uses", () => {
    assert.equal(projectsFolderPrefix("C:\\p"), "C:\\p\\");
    assert.equal(projectsFolderPrefix("/p"), "/p/");
    assert.equal(projectsFolderPrefix(""), "");
  });
});
