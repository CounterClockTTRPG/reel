import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { secretsFor } from "../../src/adapter/secrets.js";
import { loadProject, loadStudio } from "../../src/model/load.js";
import { appData, appToken, resetApp, withApp } from "../../src/app/serve.js";
import { StateBag, stateFile } from "../../src/record/state.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const APP = join(import.meta.dirname, "..", "fixtures", "serve-app.mjs");
let dir: string;

function serveProject(port: number, extra = "") {
  const file = join(dir, "projects/demo/project.yaml");
  const text = readFileSync(file, "utf8").replace(/app:\n(  .*\n)+/, [
    "app:",
    "  auth: token",
    "  serve:",
    `    command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(APP)}, --port, "{port}"${extra}]`,
    `    port: ${port}`,
    '    env: { APP_DATA: "{data}" }',
    "    ready: /health",
    '    token_file: "{data}/token"',
    "",
  ].join("\n"));
  writeFileSync(file, text);
  return async () => loadProject(await loadStudio(dir), "demo");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  process.env.REEL_DATA = tmp("reel-vault-");
  dir = studioCopy();
});

describe("app.serve", () => {
  it("starts the app, waits for it, reads its token, and stops it", async () => {
    const project = await serveProject(4801)();
    expect(project.file.app.base).toBe("http://127.0.0.1:4801");
    let pid = 0;
    await withApp(project, async (app) => {
      pid = app.pid!;
      expect(app.startedByUs).toBe(true);
      expect((await fetch(`${app.base}/health`)).status).toBe(200);
      expect(appToken(project)).toBe("app-token");
      await withApp(project, async (again) => expect(again.startedByUs).toBe(false), () => {});
    }, () => {});
    await new Promise((d) => setTimeout(d, 300));
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(appData("demo"), "token"))).toBe(true);
  }, 60_000);

  it("refuses a port that some other server answers", async () => {
    const other = createServer((_req, res) => res.writeHead(404).end("not here"));
    await new Promise<void>((r) => other.listen(4802, "127.0.0.1", () => r()));
    try {
      const project = await serveProject(4802)();
      await expect(withApp(project, async () => {}, () => {})).rejects.toThrow(/port 4802 answers 404 on \/health/);
    } finally {
      other.close();
    }
  });

  it("says why an app didn't start", async () => {
    const project = await serveProject(4803, ", --exit")();
    await expect(withApp(project, async () => {}, () => {})).rejects.toThrow(/didn't start.*refusing to start/s);
  }, 60_000);

  it("resets the app's data, the state bags and the adapter's secrets", async () => {
    mkdirSync(appData("demo"), { recursive: true });
    writeFileSync(join(appData("demo"), "delve.db"), "x");
    const bag = new StateBag(stateFile("demo", "tour"));
    bag.set("campaign", "c1");
    bag.save();
    secretsFor("demo").set("seat.ana", "pw");
    resetApp("demo");
    expect(existsSync(join(appData("demo"), "delve.db"))).toBe(false);
    expect(new StateBag(stateFile("demo", "tour")).has("campaign")).toBe(false);
    expect(secretsFor("demo").get("seat.ana")).toBeUndefined();
  });
});

describe("recording with app.serve", () => {
  it("records against the app Reel started, sending its token, and stops it after", async () => {
    const { recordMission } = await import("../../src/record/recorder.js");
    const { loadMission } = await import("../../src/model/load.js");
    const load = serveProject(4804);
    writeFileSync(join(dir, "projects/demo/missions/tour/chapters/01-basics.yaml"),
      "title: X\nscenes:\n  - id: a\n    steps:\n      - goto: /\n      - wait-for: 'text=Bearer app-token'\n      - say: Served.\n");
    writeFileSync(join(dir, "projects/demo/project.yaml"), readFileSync(join(dir, "projects/demo/project.yaml"), "utf8").replace(/^adapter: .*$/m, ""));
    const project = await load();
    const result = await recordMission({ project, mission: await loadMission(project, "tour"), log: () => {}, actionTimeout: 5000 });
    expect(result.take?.n).toBe(1);
    expect(await fetch("http://127.0.0.1:4804/health").then(() => "up", () => "down")).toBe("down");
  }, 120_000);
});
