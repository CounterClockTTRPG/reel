import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { appData, resetApp, withApp } from "../../app/serve.js";
import { isSeeded, seedApp } from "../../app/seed.js";
import { loadProject, loadStudio } from "../../model/load.js";
import { ReelError } from "../../paths.js";
import type { Output } from "../output.js";

function size(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
}

async function served(key: string) {
  const project = await loadProject(await loadStudio(), key);
  if (!project.file.app.serve) throw new ReelError(2, `project ${key} has no app.serve: Reel doesn't run its app`);
  return project;
}

export function appCommands(program: Command, out: () => Output) {
  const app = program.command("app").description("a project's own app instance (app.serve), with its data in the vault");
  app
    .command("serve <project>")
    .description("run the project's app in the foreground (Ctrl-C stops it), to try things in a browser")
    .action(async (key: string) => {
      const project = await served(key);
      const o = out();
      await withApp(project, async (a) => {
        o.log(`${key}'s app on ${a.base}${a.startedByUs ? "" : " (it was running already)"}; Ctrl-C stops it`);
        await new Promise<void>((done) => {
          process.once("SIGINT", done);
          process.once("SIGTERM", done);
        });
      }, o.log);
    });
  app
    .command("seed <project>")
    .description("fill the app's data with what the films need (the adapter's seed); safe to run again")
    .action(async (key: string) => {
      const project = await served(key);
      const o = out();
      await seedApp(project, o.log);
      o.result({ project: key, seeded: true }, `${key}'s app is seeded`);
    });
  app
    .command("reset <project>")
    .description("start the app's data over (kept aside once), with the missions' state and the adapter's secrets")
    .action(async (key: string) => {
      await served(key);
      resetApp(key);
      out().result({ project: key, reset: true }, `${key}'s app data starts over; the next recording seeds it again`);
    });
  app
    .command("status <project>")
    .description("the app's address, whether it runs, whether its data is seeded")
    .action(async (key: string) => {
      const project = await served(key);
      const serve = project.file.app.serve!;
      const running = await fetch(new URL(serve.ready, project.file.app.base), { signal: AbortSignal.timeout(2000) }).then((r) => r.status, () => null);
      const status = { base: project.file.app.base, running: running !== null, answers: running, seeded: isSeeded(key), data: appData(key), bytes: size(appData(key)) };
      out().result(status, `${status.base}: ${status.running ? `running (${running})` : "not running"}; ${status.seeded ? "seeded" : "not seeded"}; ` +
        `data ${appData(key)} (${(status.bytes / 1e6).toFixed(1)} MB)`);
    });
}
