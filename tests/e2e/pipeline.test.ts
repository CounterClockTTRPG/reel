// The whole pipeline through the real command line, as a Claude session would run it: a dry run, a recording, the
// privacy check, make, a retake of one scene.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../../src/util/proc.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli", "main.js");
let env: NodeJS.ProcessEnv;
let vault: string;

async function reel(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await run(process.execPath, [CLI, ...args], { env });
    return { code: 0, ...r };
  } catch (e) {
    const err = e as { message: string; details?: { stderr?: string } };
    const code = Number(err.message.match(/exit (\d+)/)?.[1] ?? 1);
    return { code, stdout: "", stderr: err.details?.stderr ?? err.message };
  }
}

beforeAll(async () => {
  await serveFixtureApp();
  const studio = studioCopy();
  vault = tmp("reel-e2e-vault-");
  mkdirSync(join(studio, "music"), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:a=0.3", "-ar", "44100", "-ac", "2", join(studio, "music", "calm-a.mp3")]);
  env = { ...process.env, REEL_STUDIO: studio, REEL_DATA: vault, REEL_TTS: "fake" };
});

describe("the pipeline from the command line", () => {
  it("dry-runs, records, checks, makes, and retakes one scene", async () => {
    const dry = await reel("record", "demo/tour", "--dry");
    expect(dry.code, dry.stderr).toBe(0);

    const record = await reel("record", "demo/tour");
    expect(record.code, record.stderr).toBe(0);

    const check = await reel("check", "demo/tour");
    expect(check.code, check.stderr).toBe(0);

    const noYes = await reel("make", "demo/tour");
    expect(noYes.code).toBe(4);

    const make = await reel("make", "demo/tour", "--yes", "--allow-missing");
    expect(make.code, make.stderr).toBe(0);
    for (const f of ["video.mp4", "en.srt", "nl.srt", "chapters.txt", "description.md", "thumbnail.png"]) {
      expect(existsSync(join(vault, "takes/demo/tour/1/package", f)), f).toBe(true);
    }

    const takes = JSON.parse((await reel("--json", "takes", "demo/tour")).stdout);
    expect(takes.map((t: { n: number }) => t.n)).toEqual([1]);

    const retake = JSON.parse((await reel("--json", "record", "demo/tour", "--scene", "search")).stdout);
    expect(retake.take.n).toBe(2);
    expect(retake.reused).toEqual(["intro", "result"]);
  }, 600_000);
});
