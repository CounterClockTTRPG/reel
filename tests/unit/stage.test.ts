import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overlayScript } from "../../src/record/overlay.js";
import { readingTime, Stage } from "../../src/record/stage.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { FIXTURE_STUDIO } from "../helpers/studio.js";

let browser: Browser;
let page: Page;
let stage: Stage;

beforeAll(async () => {
  const base = await serveFixtureApp();
  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 720 } });
  await context.addInitScript(overlayScript(readFileSync(join(FIXTURE_STUDIO, "library/effects/overlays/classic.css"), "utf8")));
  page = await context.newPage();
  stage = new Stage(page, { startedAt: Date.now(), scene: "intro" });
  await stage.goto("/");
});
afterAll(() => browser?.close());

describe("stage", () => {
  it("holds a caption as long as it takes to read", () => {
    expect(readingTime("one two three")).toBe(3.5);
    expect(readingTime(Array(26).fill("w").join(" "))).toBeCloseTo(11.5);
  });

  it("marks a caption with the box of what it lights", async () => {
    await stage.say("Hello there", { spot: "ul.rows", hold: 0.2 });
    const say = stage.timeline.find((e) => e.kind === "say")!;
    expect(say).toMatchObject({ scene: "intro", n: 0, note: "Hello there" });
    expect(say.box!.width).toBeGreaterThan(0);
    expect(await page.evaluate(() => typeof (window as any).__stage)).toBe("object");
  });

  it("marks a click with the element's box", async () => {
    await stage.click("#go", { rest: 0.1, after: 0.1 });
    const click = stage.timeline.find((e) => e.kind === "click")!;
    expect(click.box!.width).toBeGreaterThan(0);
  });

  it("marks a wait from its start to its end", async () => {
    await stage.goto("/");
    await stage.type("#q", "x", { delay: 5 });
    await stage.click("#go", { rest: 0.1, after: 0 });
    await stage.wait("Waiting", () => page.locator("#answer:not(:empty)").waitFor());
    const wait = stage.timeline.find((e) => e.kind === "wait")!;
    expect(wait.end! - wait.t).toBeGreaterThanOrEqual(1.8);
  });
});
