import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadAdapter } from "../../src/adapter/load.js";
import { loadProject, loadStudio, type Project } from "../../src/model/load.js";
import { effectiveStyle } from "../../src/model/style.js";
import { openSession, tokenFor, type Session } from "../../src/record/session.js";
import { StateBag } from "../../src/record/state.js";
import { runSteps, type RunContext } from "../../src/record/steps.js";
import type { Adapter } from "../../src/adapter/api.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { FIXTURE_STUDIO } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

let session: Session;
let project: Project;
let adapter: Adapter | null;

beforeAll(async () => {
  await serveFixtureApp();
  project = await loadProject(await loadStudio(FIXTURE_STUDIO), "demo");
  adapter = await loadAdapter(project.file.adapter, project.dir);
  const { style } = effectiveStyle(project);
  const overlayCss = readFileSync(join(FIXTURE_STUDIO, "library/effects/overlays/classic.css"), "utf8");
  session = await openSession({ project, style, adapter, overlayCss, actionTimeout: 2000 });
});
afterAll(() => session?.close());

async function context(seats: string[] = [], dry = false): Promise<RunContext> {
  const out = tmp();
  const host = await session.newStage("s", "host", out);
  const others = new Map(await Promise.all(seats.map(async (s) => [s, (await session.newStage("s", s, out)).stage] as const)));
  await host.stage.goto("/");
  for (const st of others.values()) await st.goto("/");
  return {
    stage: host.stage,
    seat: (name) => {
      const st = others.get(name);
      if (!st) throw new Error(`no seat ${name}`);
      return st;
    },
    state: new StateBag(join(out, "state.json")),
    adapter,
    dry,
    scene: "s",
    log: () => {},
  };
}

describe("steps", () => {
  it("hides the style's masks while recording", async () => {
    const ctx = await context();
    expect(await ctx.stage.page.locator(".private").evaluate((e) => getComputedStyle(e).visibility)).toBe("hidden");
  });

  it("goes on past an optional step whose element is missing", async () => {
    const ctx = await context();
    await runSteps([{ click: "#nope", optional: true }, { mark: "after" }], ctx);
    expect(ctx.stage.timeline.some((e) => e.title === "after")).toBe(true);
  });

  it("skips a step whose `if` finds nothing", async () => {
    const ctx = await context();
    const start = Date.now();
    await runSteps([{ click: "#nope", if: "#nope" }], ctx);
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it("fails a missing element naming the step", async () => {
    const ctx = await context();
    await expect(runSteps([{ goto: "/" }, { click: "#nope" }], ctx)).rejects.toThrow(/step 2 \(click "#nope"\)/);
  });

  it("runs parallel steps on two seats at once", async () => {
    const ctx = await context(["ana", "ben"]);
    const typing = (seat: string) => [{ type: { target: "#q", text: "abcdefghij", delay: 100 }, seat }];
    const start = Date.now();
    await runSteps([{ parallel: [typing("ana"), typing("ben")] }], ctx);
    const both = Date.now() - start;
    expect(await ctx.seat("ana").page.locator("#q").inputValue()).toBe("abcdefghij");
    expect(await ctx.seat("ben").page.locator("#q").inputValue()).toBe("abcdefghij");
    expect(both).toBeLessThan(2 * 3500);
  });

  it("stubs a step that costs money in a dry run and keeps its result", async () => {
    const ctx = await context([], true);
    await runSteps([{ "demo.act": { text: "kobold" }, as: "answer" }], ctx);
    expect(ctx.state.get("answer")).toBe("stub");
    await ctx.stage.pause(2.5);
    expect(await ctx.stage.page.locator("#answer").innerText()).toBe("");
  });

  it("keeps a real step's result under its `as`", async () => {
    const ctx = await context();
    await runSteps([{ "demo.act": { text: "kobold" }, as: "answer" }], ctx);
    expect(ctx.state.get("answer")).toBe("The answer to kobold is 42.");
  });
});

describe("tokens", () => {
  const before = { ...process.env };
  afterEach(() => { process.env = { ...before }; });

  it("prefers the environment over the secrets file", () => {
    process.env.REEL_DATA = tmp();
    mkdirSync(join(process.env.REEL_DATA, "secrets"), { recursive: true });
    writeFileSync(join(process.env.REEL_DATA, "secrets", "demo.yaml"), "token: from-file\n");
    expect(tokenFor("demo")).toBe("from-file");
    process.env.REEL_TOKEN_DEMO = "from-env";
    expect(tokenFor("demo")).toBe("from-env");
  });
});

describe("the API token", () => {
  it("goes to the app's own origin only, never to other sites the page loads", async () => {
    const { createServer } = await import("node:http");
    const seen: Record<string, string | undefined> = {};
    const other = createServer((req, res) => {
      seen.other = req.headers.authorization;
      res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" }).end("ok");
    });
    await new Promise<void>((r) => other.listen(4799, "127.0.0.1", () => r()));
    process.env.REEL_TOKEN_DEMO = "secret-token";
    const tokenProject = { ...project, file: { ...project.file, app: { ...project.file.app, auth: "token" as const } } };
    const s = await openSession({ project: tokenProject, style: effectiveStyle(project).style, adapter, overlayCss: "", actionTimeout: 2000 });
    try {
      const host = await s.newStage("t", "host", tmp());
      const own = host.stage.page.waitForRequest((r) => r.url().endsWith("/index.html"));
      await host.stage.page.goto("/index.html");
      expect((await own).headers().authorization).toBe("Bearer secret-token");
      await host.stage.page.evaluate(() => fetch("http://localhost:4799/x").then((r) => r.text()));
      expect(seen.other).toBeUndefined();
    } finally {
      await s.close();
      other.close();
      delete process.env.REEL_TOKEN_DEMO;
    }
  });
});

describe("state in steps", () => {
  it("fills {{key}} in a step's text from what an earlier step kept", async () => {
    const ctx = await context();
    ctx.state.set("page", "index.html");
    await runSteps([{ goto: "/{{page}}" }, { mark: "on {{page}}" }], ctx);
    expect(ctx.stage.page.url()).toMatch(/\/index\.html$/);
    expect(ctx.stage.timeline.some((e) => e.title === "on index.html")).toBe(true);
  });

  it("fails a step whose {{key}} nothing kept, naming the key", async () => {
    const ctx = await context();
    await expect(runSteps([{ goto: "/{{nothing}}" }], ctx)).rejects.toThrow(/\{\{nothing\}\}.*no earlier step kept/);
  });
});
