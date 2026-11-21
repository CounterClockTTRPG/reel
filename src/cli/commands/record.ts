import type { Command } from "commander";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadProject, loadStudio } from "../../model/load.js";
import { recordMission } from "../../record/recorder.js";
import { authFile } from "../../record/session.js";
import type { Output } from "../output.js";
import { loadTarget } from "../target.js";

export function recordCommands(program: Command, out: () => Output) {
  program
    .command("record <mission>")
    .description("record a mission's scenes (those changed, named, or flagged) and make a new take")
    .option("--scene <id...>", "retake these scenes (and keep the others)")
    .option("--flagged", "retake the scenes the review flagged in the latest take")
    .option("--all", "retake every scene")
    .option("--dry", "click through every scene without anything that costs money or changes state; makes no take")
    .option("--headed", "show the browser while it records")
    .option("--fresh", "start the project's app data over first (app.serve); every scene is recorded again")
    .action(async (target: string, o: { scene?: string[]; flagged?: boolean; all?: boolean; dry?: boolean; headed?: boolean; fresh?: boolean }) => {
      const { project, mission } = await loadTarget(target);
      const o2 = out();
      const result = await recordMission({ project, mission, scenes: o.scene, flagged: o.flagged, all: o.fresh || o.all, dry: o.dry, headed: o.headed, fresh: o.fresh, log: o2.log });
      o2.result(
        { ...result, take: result.take && { project: result.take.project, mission: result.take.mission, n: result.take.n } },
        o.dry
          ? `Dry run done: ${result.recorded.length} scenes clicked through${result.skippedDry.length ? `, ${result.skippedDry.length} not reachable dry` : ""}`
          : `Take ${target}/${result.take!.n}: recorded ${result.recorded.length}, reused ${result.reused.length}`,
      );
    });

  program
    .command("login <project>")
    .description("log in by hand in a visible browser; the session is saved in the vault for recording")
    .action(async (key: string) => {
      const project = await loadProject(await loadStudio(), key);
      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(project.file.app.base);
      const o2 = out();
      o2.log(`Log in to ${project.file.app.base} in the browser window, then close the window.`);
      await page.waitForEvent("close", { timeout: 10 * 60_000 }).catch(() => {});
      const file = authFile(key);
      mkdirSync(dirname(file), { recursive: true });
      await context.storageState({ path: file });
      await browser.close();
      o2.result({ saved: file }, `Saved the session to ${file}; set app.auth: login in project.yaml to use it.`);
    });
}
