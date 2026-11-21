// A project's app, started by Reel (app.serve in project.yaml): a separate instance with its data in the vault, so
// recording never touches anyone's real data. Reel starts it when nothing answers on its port, waits until it's ready,
// runs what needs it, and stops it again. One run per project uses it at a time.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, closeSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { secretsFor } from "../adapter/secrets.js";
import { withAppLock } from "../jobs/lock.js";
import type { Project } from "../model/load.js";
import { expandHome, ReelError, vaultDir } from "../paths.js";
import { authFile } from "../record/session.js";

export const appDir = (projectKey: string) => join(vaultDir(), "apps", projectKey);
export const appData = (projectKey: string) => join(appDir(projectKey), "data");
export const serveLog = (projectKey: string) => join(appDir(projectKey), "serve.log");

/** A serve setting with its placeholders filled: {port}, {data}; ~ expanded. */
export function fill(project: Project, text: string): string {
  const serve = project.file.app.serve!;
  return expandHome(text.replaceAll("{port}", String(serve.port)).replaceAll("{data}", appData(project.key)));
}

/** The app's token, from serve.token_file. */
export function appToken(project: Project): string | undefined {
  const file = project.file.app.serve?.token_file;
  if (!file) return undefined;
  const path = fill(project, file);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}

export interface RunningApp {
  base: string;
  data: string;
  startedByUs: boolean;
  pid?: number;
}

/** What the port answers on the ready path: its status, or null when nothing listens. */
async function probe(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" });
    await res.body?.cancel();
    return res.status;
  } catch {
    return null;
  }
}

const ok = (status: number | null) => status !== null && status >= 200 && status < 400;
const tail = (file: string, n = 10) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").slice(-n).join("\n") : "");

// Apps this process is using now, so a run inside a run (seeding before a recording) shares one.
const active = new Map<string, RunningApp>();

export interface AppControl {
  stop(): Promise<void>;
  start(): Promise<void>;
}

/** Runs `fn` with the project's app up (started if needed, stopped afterwards when Reel started it). */
export async function withApp<T>(project: Project, fn: (app: RunningApp, control: AppControl) => Promise<T>, log: (m: string) => void): Promise<T> {
  const serve = project.file.app.serve;
  if (!serve) throw new ReelError(1, `project ${project.key} has no app.serve`);
  const already = active.get(project.key);
  if (already) return fn({ ...already, startedByUs: false }, { stop: async () => {}, start: async () => {} });
  return withAppLock(project.key, async () => {
    const base = project.file.app.base;
    const readyUrl = new URL(serve.ready, base).href;
    const data = appData(project.key);
    mkdirSync(data, { recursive: true, mode: 0o700 });
    let child: ChildProcess | null = null;

    const start = async () => {
      const status = await probe(readyUrl);
      if (ok(status)) return;
      if (status !== null) {
        throw new ReelError(1, `port ${serve.port} answers ${status} on ${serve.ready}: it isn't ${project.key}'s app (stop what runs there, or change app.serve.port)`);
      }
      const [cmd, ...args] = serve.command.map((c) => fill(project, c));
      const cwd = serve.cwd ? resolve(project.dir, fill(project, serve.cwd)) : project.dir;
      const env = { ...process.env, ...Object.fromEntries(Object.entries(serve.env).map(([k, v]) => [k, fill(project, v)])) };
      mkdirSync(appDir(project.key), { recursive: true });
      const out = openSync(serveLog(project.key), "a");
      log(`  starting ${project.key}'s app: ${[cmd, ...args].join(" ")}`);
      child = spawn(isAbsolute(cmd) || cmd.includes("/") ? resolve(cwd, cmd) : cmd, args, { cwd, env, stdio: ["ignore", out, out], windowsHide: true });
      closeSync(out);
      let exited: number | null = null;
      child.on("exit", (code) => (exited = code ?? -1));
      child.on("error", () => (exited = -1));
      const deadline = Date.now() + serve.timeout * 1000;
      while (Date.now() < deadline) {
        if (exited !== null) {
          child = null;
          throw new ReelError(1, `${project.key}'s app didn't start (exit ${exited}):\n${tail(serveLog(project.key))}`);
        }
        if (ok(await probe(readyUrl))) {
          log(`  ${project.key}'s app is ready on ${base}`);
          return;
        }
        await new Promise((d) => setTimeout(d, 250));
      }
      await stop();
      throw new ReelError(1, `${project.key}'s app didn't start within ${serve.timeout} s:\n${tail(serveLog(project.key))}`);
    };

    const stop = async () => {
      const c = child as ChildProcess | null;
      if (!c || c.exitCode !== null) return;
      const gone = new Promise<void>((done) => c.once("exit", () => done()));
      c.kill("SIGTERM");
      const timer = setTimeout(() => c.kill("SIGKILL"), 10_000);
      await gone;
      clearTimeout(timer);
      child = null;
    };

    await start();
    const app: RunningApp = { base, data, startedByUs: child !== null, pid: (child as ChildProcess | null)?.pid };
    active.set(project.key, app);
    try {
      return await fn(app, { stop, start });
    } finally {
      active.delete(project.key);
      if (app.startedByUs) {
        await stop();
        log(`  stopped ${project.key}'s app`);
      }
    }
  }, log);
}

/**
 * Starts the app's data over: the data folder moves aside (the newest old one is kept), and the mission state bags,
 * the adapter's secrets and the saved login go, since what they name is gone.
 */
export function resetApp(projectKey: string): void {
  const dir = appDir(projectKey);
  if (existsSync(appData(projectKey))) {
    for (const old of existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("data.old-")) : []) rmSync(join(dir, old), { recursive: true, force: true });
    renameSync(appData(projectKey), join(dir, `data.old-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  }
  rmSync(join(vaultDir(), "state", projectKey), { recursive: true, force: true });
  secretsFor(projectKey).clear();
  rmSync(authFile(projectKey), { force: true });
}
