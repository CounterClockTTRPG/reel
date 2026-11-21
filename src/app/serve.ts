// A project's app, started by Reel (app.serve in project.yaml): a separate instance with its data in the vault, so
// recording never touches anyone's real data. Reel starts it when nothing answers on its port, waits until it's ready,
// runs what needs it, and stops it again. One run per project uses it at a time.
//
// Reel only ever uses an app it started itself: it keeps a pid file (~/.reel/apps/<project>/serve.pid) while the app
// runs. Anything else answering on the port is refused, so a recording never lands in the wrong app's data. Apps run
// in a process group of their own, stopped as a group; a run that exits without its cleanup still stops them (an
// exit handler), and `reel app stop` stops one a killed run left behind.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { secretsFor } from "../adapter/secrets.js";
import { withAppLock } from "../jobs/lock.js";
import type { Project } from "../model/load.js";
import { expandHome, ReelError, vaultDir } from "../paths.js";
import { authFile } from "../record/session.js";

export const appDir = (projectKey: string) => join(vaultDir(), "apps", projectKey);
export const appData = (projectKey: string) => join(appDir(projectKey), "data");
export const serveLog = (projectKey: string) => join(appDir(projectKey), "serve.log");
export const pidFile = (projectKey: string) => join(appDir(projectKey), "serve.pid");

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

type Probe = { status: number } | "nothing" | "busy";

/** What the port answers on the ready path: a status, nothing listening, or no answer in time (busy). */
async function probe(url: string): Promise<Probe> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    await res.body?.cancel();
    return { status: res.status };
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    return cause === "ECONNREFUSED" || cause === "ECONNRESET" ? "nothing" : (e as Error).name === "TimeoutError" ? "busy" : "nothing";
  }
}

const ready = (p: Probe) => typeof p === "object" && p.status >= 200 && p.status < 300;
const tail = (file: string, n = 10) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").slice(-n).join("\n") : "");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The app a Reel run started and is still running, from its pid file. */
function startedApp(projectKey: string): { pid: number; port: number } | null {
  try {
    const kept = JSON.parse(readFileSync(pidFile(projectKey), "utf8")) as { pid: number; port: number };
    return alive(kept.pid) ? kept : null;
  } catch {
    return null;
  }
}

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

// Apps this process started: stopped when it exits, however it exits.
const spawned = new Set<number>();
let exitHook = false;
function stopOnExit(pid: number) {
  spawned.add(pid);
  if (exitHook) return;
  exitHook = true;
  process.on("exit", () => {
    for (const p of spawned) killGroup(p, "SIGTERM");
  });
}

// Apps this process is using now, so a run inside a run (seeding before a recording) shares one.
const active = new Map<string, RunningApp>();

export interface AppControl {
  /** Stops the app (for its own tools to work on its data); refused when this run didn't start it. */
  stop(): Promise<void>;
  start(): Promise<void>;
}

/** Runs `fn` with the project's app up (started if needed, stopped afterwards when this run started it). */
export async function withApp<T>(project: Project, fn: (app: RunningApp, control: AppControl) => Promise<T>, log: (m: string) => void): Promise<T> {
  const serve = project.file.app.serve;
  if (!serve) throw new ReelError(1, `project ${project.key} has no app.serve`);
  const notOurs = async () => {
    throw new ReelError(1, `${project.key}'s app wasn't started by this run, so it isn't stopped here: stop it first (reel app stop ${project.key})`);
  };
  const already = active.get(project.key);
  if (already) return fn({ ...already, startedByUs: false }, { stop: notOurs, start: async () => {} });
  return withAppLock(project.key, async () => {
    const base = project.file.app.base;
    const readyUrl = new URL(serve.ready, base).href;
    const data = appData(project.key);
    mkdirSync(data, { recursive: true, mode: 0o700 });
    let child: ChildProcess | null = null;
    let exited: Promise<void> = Promise.resolve();
    let reused = false;

    const start = async () => {
      const found = await probe(readyUrl);
      if (found === "busy") throw new ReelError(1, `port ${serve.port} doesn't answer ${serve.ready} in time: something is there, but it isn't ready`);
      if (found !== "nothing") {
        const ours = startedApp(project.key);
        if (ready(found) && ours && ours.port === serve.port) {
          reused = true;
          return;
        }
        throw new ReelError(1, `port ${serve.port} answers ${found.status} on ${serve.ready}, but it isn't one Reel started for ${project.key} ` +
          `(its data would not be ${data}): stop what runs there, or change app.serve.port`);
      }
      const [cmd, ...args] = serve.command.map((c) => fill(project, c));
      const cwd = serve.cwd ? resolve(project.dir, fill(project, serve.cwd)) : project.dir;
      const env = { ...process.env, ...Object.fromEntries(Object.entries(serve.env).map(([k, v]) => [k, fill(project, v)])) };
      mkdirSync(appDir(project.key), { recursive: true });
      const out = openSync(serveLog(project.key), "a");
      log(`  starting ${project.key}'s app: ${[cmd, ...args].join(" ")}`);
      const c = spawn(isAbsolute(cmd) || cmd.includes("/") ? resolve(cwd, cmd) : cmd, args, {
        cwd, env, stdio: ["ignore", out, out], windowsHide: true, detached: process.platform !== "win32",
      });
      closeSync(out);
      child = c;
      let gone = false;
      exited = new Promise<void>((done) => {
        c.once("exit", () => {
          gone = true;
          if (c.pid) spawned.delete(c.pid);
          rmSync(pidFile(project.key), { force: true });
          done();
        });
        c.once("error", () => {
          gone = true;
          done();
        });
      });
      if (c.pid) {
        stopOnExit(c.pid);
        writeFileSync(pidFile(project.key), JSON.stringify({ pid: c.pid, port: serve.port, started: new Date().toISOString() }));
      }
      const deadline = Date.now() + serve.timeout * 1000;
      while (Date.now() < deadline) {
        if (gone) {
          child = null;
          throw new ReelError(1, `${project.key}'s app didn't start (it exited):\n${tail(serveLog(project.key))}`);
        }
        if (ready(await probe(readyUrl))) {
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
      if (!c) return;
      if (c.exitCode === null && c.signalCode === null && c.pid) {
        killGroup(c.pid, "SIGTERM");
        const timer = setTimeout(() => killGroup(c.pid!, "SIGKILL"), 10_000);
        await exited;
        clearTimeout(timer);
      }
      child = null;
    };

    await start();
    const app: RunningApp = { base, data, startedByUs: !reused, pid: (child as ChildProcess | null)?.pid };
    active.set(project.key, app);
    try {
      return await fn(app, { stop: reused ? notOurs : stop, start: reused ? async () => {} : start });
    } finally {
      active.delete(project.key);
      if (!reused) {
        await stop();
        log(`  stopped ${project.key}'s app`);
      }
    }
  }, log);
}

/** `reel app stop`: stops an app a Reel run started and left running. True when there was one. */
export async function stopLeftApp(project: Project): Promise<boolean> {
  const kept = startedApp(project.key);
  if (!kept) {
    rmSync(pidFile(project.key), { force: true });
    return false;
  }
  killGroup(kept.pid, "SIGTERM");
  for (let i = 0; i < 40 && alive(kept.pid); i++) await new Promise((d) => setTimeout(d, 250));
  if (alive(kept.pid)) killGroup(kept.pid, "SIGKILL");
  rmSync(pidFile(project.key), { force: true });
  return true;
}

/**
 * Starts the app's data over: the data folder moves aside (the newest old one is kept), and the mission state bags,
 * the adapter's secrets and the saved login go, since what they name is gone. Refused while the app runs.
 */
export async function resetApp(project: Project): Promise<void> {
  const serve = project.file.app.serve;
  if (!serve) throw new ReelError(2, `project ${project.key} has no app.serve`);
  const running = () => new ReelError(1, `${project.key}'s app is running on port ${serve.port}: stop it before its data starts over (reel app stop ${project.key})`);
  if (active.has(project.key)) throw running();
  await withAppLock(project.key, async () => {
    if ((await probe(new URL(serve.ready, project.file.app.base).href)) !== "nothing") throw running();
    const dir = appDir(project.key);
    if (existsSync(appData(project.key))) {
      for (const old of readdirSync(dir).filter((f) => f.startsWith("data.old-"))) rmSync(join(dir, old), { recursive: true, force: true });
      renameSync(appData(project.key), join(dir, `data.old-${new Date().toISOString().replace(/[:.]/g, "-")}`));
    }
    rmSync(join(vaultDir(), "state", project.key), { recursive: true, force: true });
    secretsFor(project.key).clear();
    rmSync(authFile(project.key), { force: true });
  }, () => {});
}
