// Seeding a project's app: the adapter's `seed` fills a new data folder once (packs, an owner account, the content
// the films show). A data folder with `.reel-seeded` is seeded; `reel record` seeds one that isn't, first.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { request } from "playwright";
import type { SeedContext } from "../adapter/api.js";
import { loadAdapter } from "../adapter/load.js";
import { secretsFor } from "../adapter/secrets.js";
import type { Project } from "../model/load.js";
import { ReelError } from "../paths.js";
import { checkedOptions } from "../record/recorder.js";
import { authFile } from "../record/session.js";
import { run } from "../util/proc.js";
import { appData, appToken, fill, withApp } from "./serve.js";

export const isSeeded = (projectKey: string) => existsSync(join(appData(projectKey), ".reel-seeded"));

export async function seedApp(project: Project, log: (m: string) => void): Promise<void> {
  const adapter = await loadAdapter(project.file.adapter, project.dir);
  if (!adapter?.seed) throw new ReelError(2, `project ${project.key}'s adapter has nothing to seed`);
  const options = checkedOptions(project, adapter);
  const serve = project.file.app.serve;
  if (!serve) throw new ReelError(2, `project ${project.key} has no app.serve to seed`);
  const env = Object.fromEntries(Object.entries(serve.env).map(([k, v]) => [k, fill(project, v)]));
  log(`Seeding ${project.key}'s app`);
  await withApp(project, async (app, control) => {
    const token = appToken(project);
    const api = await request.newContext({
      baseURL: app.base,
      ...(token ? { extraHTTPHeaders: { authorization: `Bearer ${token}` } } : {}),
      ...(existsSync(authFile(project.key)) ? { storageState: authFile(project.key) } : {}),
    });
    const ctx: SeedContext = {
      project: project.key,
      base: app.base,
      data: app.data,
      api,
      options,
      secrets: secretsFor(project.key),
      log,
      run: (cmd, args, opts = {}) =>
        run(cmd, args, { cwd: opts.cwd ?? (serve.cwd ? fill(project, serve.cwd) : project.dir), env: { ...process.env, ...env, ...opts.env } }),
      stopApp: () => control.stop(),
      startApp: () => control.start(),
      saveLogin(state) {
        mkdirSync(dirname(authFile(project.key)), { recursive: true, mode: 0o700 });
        writeFileSync(authFile(project.key), JSON.stringify(state, null, 2), { mode: 0o600 });
      },
    };
    try {
      await adapter.seed!(ctx);
    } catch (e) {
      if (e instanceof ReelError) throw e;
      throw new ReelError(1, `seeding ${project.key}: ${(e as Error).message}`);
    } finally {
      await api.dispose();
    }
    writeFileSync(join(app.data, ".reel-seeded"), `${new Date().toISOString()}\n`);
  }, log);
  log(`Seeded ${project.key}'s app`);
}
