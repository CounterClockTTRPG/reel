import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appData } from "../../src/app/serve.js";
import { isSeeded, seedApp } from "../../src/app/seed.js";
import { secretsFor } from "../../src/adapter/secrets.js";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { recordMission } from "../../src/record/recorder.js";
import { authFile } from "../../src/record/session.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const APP = join(import.meta.dirname, "..", "fixtures", "serve-app.mjs");
let dir: string;

async function project(port: number) {
  const file = join(dir, "projects/demo/project.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace(/app:\n(  .*\n)+/, [
    "app:",
    "  auth: none",
    "  serve:",
    `    command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(APP)}, --port, "{port}"]`,
    `    port: ${port}`,
    '    env: { APP_DATA: "{data}" }',
    "    ready: /health",
    "",
  ].join("\n")));
  return loadProject(await loadStudio(dir), "demo");
}

beforeEach(() => {
  process.env.REEL_DATA = tmp("reel-vault-");
  dir = studioCopy();
});

describe("seeding an app", () => {
  it("runs the adapter's seed with the app stopped and started, and remembers it", async () => {
    const p = await project(4811);
    const lines: string[] = [];
    await seedApp(p, (m) => lines.push(m));
    expect(readFileSync(join(appData("demo"), "seeded-by-fixture"), "utf8")).toBe("yes");
    expect(isSeeded("demo")).toBe(true);
    expect(existsSync(authFile("demo"))).toBe(true);
    expect(secretsFor("demo").get("owner")).toBe("pw");
    expect(lines.join("\n")).toContain("health 200");
  }, 60_000);

  it("turns an adapter's failure into a plain error naming the project", async () => {
    const file = join(dir, "projects/demo/project.yaml");
    writeFileSync(file, readFileSync(file, "utf8") + "adapter_options: { greeting: fail }\n");
    const p = await project(4813);
    const err = await seedApp(p, () => {}).catch((e) => e);
    expect(err.code).toBe(1);
    expect(err.message).toMatch(/seeding demo: the fixture refuses to seed/);
    expect(isSeeded("demo")).toBe(false);
  }, 60_000);

  it("seeds before recording into data that was never seeded", async () => {
    const p = await project(4812);
    writeFileSync(join(dir, "projects/demo/missions/tour/chapters/01-basics.yaml"),
      "title: X\nscenes:\n  - id: a\n    steps:\n      - goto: /\n      - say: Seeded first.\n");
    await recordMission({ project: p, mission: await loadMission(p, "tour"), log: () => {}, actionTimeout: 5000 });
    expect(isSeeded("demo")).toBe(true);
  }, 120_000);
});
