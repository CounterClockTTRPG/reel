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
    await resetApp(await serveProject(4899)());
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

describe("the app's lifecycle", () => {
  it("refuses an app on the port that Reel didn't start, even when it answers 200", async () => {
    const other = createServer((_req, res) => res.writeHead(200).end("ok"));
    await new Promise<void>((r) => other.listen(4805, "127.0.0.1", () => r()));
    try {
      const project = await serveProject(4805)();
      await expect(withApp(project, async () => {}, () => {})).rejects.toThrow(/port 4805 answers.*isn't one Reel started/);
    } finally {
      other.close();
    }
  });

  it("finishes when the app was killed by a signal meanwhile", async () => {
    const project = await serveProject(4806)();
    await withApp(project, async (app) => {
      process.kill(-app.pid!, "SIGKILL");
      await new Promise((d) => setTimeout(d, 300));
    }, () => {});
  }, 60_000);

  it("refuses to stop for seeding an app Reel isn't running itself", async () => {
    const project = await serveProject(4807)();
    await withApp(project, async () => {
      await withApp(project, async (_inner, control) => {
        await expect(control.stop()).rejects.toThrow(/wasn't started by this run/);
      }, () => {});
    }, () => {});
  }, 60_000);

  it("won't start the data over while the app is running", async () => {
    const project = await serveProject(4808)();
    const { resetApp: reset } = await import("../../src/app/serve.js");
    await withApp(project, async () => {
      await expect(reset(project)).rejects.toThrow(/running on port 4808/);
    }, () => {});
  }, 60_000);

  it("stops an app a run left behind (reel app stop), from its pid file", async () => {
    const project = await serveProject(4809)();
    const { stopLeftApp } = await import("../../src/app/serve.js");
    const { spawnSync } = await import("node:child_process");
    // A process that starts the app and exits without its finally (as a killed run would).
    const script = `import { loadStudio, loadProject } from ${JSON.stringify(join(import.meta.dirname, "../../dist/model/load.js"))};
      import { withApp } from ${JSON.stringify(join(import.meta.dirname, "../../dist/app/serve.js"))};
      const p = await loadProject(await loadStudio(${JSON.stringify(dir)}), "demo");
      await withApp(p, async () => { process.exit(0); }, () => {});`;
    spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: process.env });
    // The run's exit handler stopped its app.
    await expect.poll(() => fetch("http://127.0.0.1:4809/health").then(() => "up", () => "down"), { timeout: 5000 }).toBe("down");
    expect(await stopLeftApp(project)).toBe(false);
  }, 60_000);
});
