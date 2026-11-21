import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cutTake } from "../../src/edit/join.js";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { measureLufs, mixTake } from "../../src/sound/mix.js";
import { voiceTake } from "../../src/sound/voice.js";
import { fakeProvider } from "../../src/sound/tts.js";
import { run } from "../../src/util/proc.js";
import { recordedTake, type Recorded } from "../helpers/recorded.js";

let r: Recorded;
let total: number;

async function reload(projectYaml?: (s: string) => string) {
  const file = join(r.studio, "projects/demo/project.yaml");
  if (projectYaml) writeFileSync(file, projectYaml(readFileSync(file, "utf8")));
  const project = await loadProject(await loadStudio(r.studio), "demo");
  return { project, mission: await loadMission(project, "tour") };
}

beforeAll(async () => {
  r = await recordedTake();
  const music = join(r.studio, "music");
  mkdirSync(music, { recursive: true });
  // A loud, short track (12 s, about -10 LUFS), so the film outlasts it and it must loop.
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=12:c=pink:a=0.5", "-ar", "44100", "-ac", "2", join(music, "calm-a.mp3")]);
  const plan = (await cutTake(r.ref, r.project, r.mission)).plan;
  total = plan.total;
  mkdirSync(join(r.ref.dir, "checks"), { recursive: true });
  writeFileSync(join(r.ref.dir, "checks", "privacy.json"), JSON.stringify({ ok: true, hits: [] }));
  await voiceTake(r.ref, r.project, r.mission, { yes: true, provider: fakeProvider() });
}, 600_000);

describe("mixing", () => {
  it("keeps the music well under the voice and passes the check", async () => {
    const { project, mission } = await reload();
    const { loudness } = await mixTake(r.ref, project, mission);
    expect(loudness.ok).toBe(true);
    expect(loudness.margin).toBeGreaterThanOrEqual(12);
  }, 300_000);

  it("loops a track the film outlasts", async () => {
    const lufs = await measureLufs(join(r.ref.dir, "mix.mp4"), [[total - 6, total - 5]]);
    expect(lufs).toBeGreaterThan(-50);
  }, 120_000);

  it("fails the check when the music is too loud", async () => {
    const { project, mission } = await reload((s) => s.replace("loudness: -33", "loudness: -18"));
    const { loudness } = await mixTake(r.ref, project, mission);
    expect(loudness.ok).toBe(false);
    expect(loudness.stretches.length).toBeGreaterThan(0);
  }, 300_000);

  it("names a track that is missing from disk", async () => {
    const { project, mission } = await reload((s) => s.replace("loudness: -18", "loudness: -33"));
    rmSync(join(r.studio, "music", "calm-a.mp3"));
    await expect(mixTake(r.ref, project, mission)).rejects.toThrow(/calm-a\.mp3/);
  }, 120_000);
});
