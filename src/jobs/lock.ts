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
  const file = lockFile(project, mission);
  mkdirSync(join(vaultDir(), "locks"), { recursive: true });
  const mine = JSON.stringify({ pid: process.pid, host: hostname(), started: new Date().toISOString() });
  try {
    writeFileSync(file, mine, { flag: "wx" });
  } catch {
    const holder = JSON.parse(readFileSync(file, "utf8")) as { pid: number; started: string };
    if (holder.pid !== process.pid && alive(holder.pid)) {
      throw new ReelError(1, `mission ${project}/${mission} is being recorded by pid ${holder.pid} (since ${holder.started})`);
    }
    if (holder.pid === process.pid) throw new ReelError(1, `mission ${project}/${mission} is being recorded by pid ${holder.pid} (this process)`);
    warn(`took over the lock of ${project}/${mission} from pid ${holder.pid}, which is gone`);
    writeFileSync(file, mine);
  }
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}
