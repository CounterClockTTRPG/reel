// One recording of a mission at a time, whether it is started from the CLI or the web UI: a lock file in the vault
// holding the holder's pid. A lock left behind by a process that died is taken over.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ReelError, vaultDir } from "../paths.js";

export const lockFile = (project: string, mission: string) => join(vaultDir(), "locks", `${project}--${mission}.lock`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function withMissionLock<T>(
  project: string,
  mission: string,
  fn: () => Promise<T>,
  warn: (msg: string) => void = (m) => process.stderr.write(`${m}\n`),
): Promise<T> {
  return withLock(lockFile(project, mission), `mission ${project}/${mission}`, "being recorded", fn, warn);
}

/** One running app per project: the lock its runs take while they use it. */
export async function withAppLock<T>(project: string, fn: () => Promise<T>, warn: (msg: string) => void): Promise<T> {
  return withLock(join(vaultDir(), "locks", `${project}--app.lock`), `${project}'s app`, "in use", fn, warn);
}

async function withLock<T>(file: string, what: string, doing: string, fn: () => Promise<T>, warn: (msg: string) => void): Promise<T> {
  mkdirSync(join(vaultDir(), "locks"), { recursive: true });
  const mine = JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() });
  try {
    writeFileSync(file, mine, { flag: "wx" });
  } catch {
    let holder: { pid: number; host?: string; started: string } | null = null;
    try {
      holder = JSON.parse(readFileSync(file, "utf8"));
    } catch {}
    const held = (why: string) =>
      new ReelError(1, `${what} is ${doing} by pid ${holder!.pid} (${why}); if that's wrong, delete ${file}`);
    if (holder && typeof holder.pid === "number") {
      if (holder.pid === process.pid) throw held("this process");
      if (holder.host && holder.host !== hostname()) throw held(`on ${holder.host}, since ${holder.started}`);
      if (alive(holder.pid)) throw held(`since ${holder.started}`);
      warn(`took over the lock of ${what} from pid ${holder.pid}, which is gone`);
    } else {
      warn(`took over the lock of ${what}: its lock file couldn't be read`);
    }
    writeFileSync(file, mine);
  }
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}
