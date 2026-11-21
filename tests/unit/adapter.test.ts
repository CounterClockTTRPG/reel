import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAdapter } from "../../src/adapter/load.js";
import { resolveStep } from "../../src/adapter/core.js";
import { FIXTURE_STUDIO } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const projectDir = join(FIXTURE_STUDIO, "projects", "demo");

describe("adapters", () => {
  it("loads an adapter by a path relative to the project", async () => {
    const adapter = await loadAdapter("../../../adapter/index.js", projectDir);
    expect(adapter?.name).toBe("demo");
    expect(Object.keys(adapter!.steps).sort()).toEqual(["act", "reset"]);
  });

  it("has no adapter when the project names none", async () => {
    expect(await loadAdapter(undefined, projectDir)).toBeNull();
  });

  it("rejects an adapter whose step names have a dot", async () => {
    const file = join(tmp(), "bad.mjs");
    writeFileSync(file, "export default { name: 'bad', version: '1', steps: { 'x.y': { args: null, run() {} } } };");
    await expect(loadAdapter(file, projectDir)).rejects.toThrow(/x\.y/);
  });

  it("checks an adapter step's arguments, naming the step", async () => {
    const adapter = await loadAdapter("../../../adapter/index.js", projectDir);
    expect(() => resolveStep({ "demo.act": { text: 5 } }, adapter)).toThrow(/demo\.act/);
    expect(resolveStep({ "demo.act": { text: "a" }, as: "x" }, adapter).def.costs).toBe(true);
  });

  it("resolves a core step and refuses an adapter step with no adapter", () => {
    expect(resolveStep({ click: "#go" }, null).name).toBe("click");
    expect(() => resolveStep({ "demo.act": { text: "a" } }, null)).toThrow(/no adapter/);
  });
});
