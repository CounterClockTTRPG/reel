// Child processes, always with an argument array (never a shell string), so paths with spaces and Windows paths work.
import { spawn } from "node:child_process";
import { ReelError } from "../paths.js";

export interface RunOptions {
  cwd?: string;
  input?: string | Buffer;
  env?: NodeJS.ProcessEnv;
}

/** Runs `cmd` and resolves with its output; rejects naming the command and its first file-like argument. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) =>
      reject(new ReelError(1, `${cmd}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "not installed (not on the PATH)" : e.message}`)),
    );
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString();
      const stderr = Buffer.concat(err).toString();
      if (code === 0) return resolve({ stdout, stderr });
      const file = args.find((a) => /[./\\]/.test(a) && !a.startsWith("-"));
      const tail = stderr.trim().split("\n").slice(-3).join("\n");
      reject(new ReelError(1, `${cmd} failed (exit ${code})${file ? ` on ${file}` : ""}: ${tail}`, { stderr }));
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** The duration of a media file in seconds. */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = Number(stdout.trim());
  if (!Number.isFinite(d)) throw new ReelError(1, `ffprobe: no duration for ${file}`);
  return d;
}

/** Fails with a clear message when a tool Reel needs is not on the PATH. */
export async function requireTools(...names: string[]): Promise<void> {
  for (const name of names) {
    const flag = name === "tesseract" ? "--version" : "-version";
    await run(name, [flag]).catch(() => {
      throw new ReelError(1, `${name} is not installed (or not on the PATH); see the README's install section`);
    });
  }
}
