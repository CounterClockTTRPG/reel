import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { secretsFor } from "../../src/adapter/secrets.js";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { recordMission } from "../../src/record/recorder.js";
import { StateBag, stateFile } from "../../src/record/state.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const CHAPTER = "projects/demo/missions/tour/chapters/01-basics.yaml";
let dir: string;
const tour = async () => {
  const project = await loadProject(await loadStudio(dir), "demo");
  return { project, mission: await loadMission(project, "tour") };
};
const quiet = { log: () => {}, actionTimeout: 2000 };

beforeAll(async () => {
  await serveFixtureApp();
});

describe("adapter extensions", () => {
  it("picks an option with select, and runs init on every seat", async () => {
    process.env.REEL_DATA = tmp();
    dir = studioCopy();
    writeFileSync(join(dir, CHAPTER), "title: X\nscenes:\n  - id: a\n    steps:\n      - goto: /\n      - { goto: /, seat: ana }\n" +
      "      - select: { target: '#pick', label: Bravo }\n      - css: 'body { }'\n        as: unused\n");
    await recordMission({ ...(await tour()), ...quiet });
    const state = new StateBag(stateFile("demo", "tour"));
    expect(state.get("inits")).toEqual(["host", "ana"]);
  }, 120_000);

  it("keeps an adapter's secrets beside the project's token", () => {
    process.env.REEL_DATA = tmp();
    const s = secretsFor("demo");
    s.set("seat.tour-ana", "pw1");
    const file = join(process.env.REEL_DATA, "secrets", "demo.yaml");
    writeFileSync(file, readFileSync(file, "utf8") + "token: keep-me\n");
    s.set("seat.tour-ben", "pw2");
    expect(secretsFor("demo").get("seat.tour-ana")).toBe("pw1");
    expect(readFileSync(file, "utf8")).toContain("token: keep-me");
  });

  it("refuses adapter options the adapter doesn't know", async () => {
    process.env.REEL_DATA = tmp();
    dir = studioCopy();
    const file = join(dir, "projects/demo/project.yaml");
    writeFileSync(file, readFileSync(file, "utf8") + "adapter_options: { greting: hi }\n");
    await expect(recordMission({ ...(await tour()), ...quiet, dry: true })).rejects.toThrow(/adapter_options.*greting/);
  });
});
