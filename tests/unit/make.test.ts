import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { makeTake } from "../../src/pipeline/make.js";
import { createMission, createProject } from "../../src/studio/create.js";
import { fakeProvider, type TtsProvider } from "../../src/sound/tts.js";
import { run } from "../../src/util/proc.js";
import { recordedTake } from "../helpers/recorded.js";
import { studioCopy } from "../helpers/studio.js";

async function withMusic() {
  const r = await recordedTake();
  mkdirSync(join(r.studio, "music"), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:a=0.3", "-ar", "44100", "-ac", "2", join(r.studio, "music", "calm-a.mp3")]);
  return r;
}

describe("reel make", () => {
  it("runs check, cut, voice, mix and package", async () => {
    const r = await withMusic();
    const result = await makeTake(r.ref, r.project, r.mission, { yes: true, allowMissing: true, provider: fakeProvider() });
    expect(result.steps.map((s) => s.name)).toEqual(["check", "cut", "voice", "mix", "package"]);
    expect(existsSync(join(r.ref.dir, "package", "video.mp4"))).toBe(true);
  }, 600_000);

  it("stops at the voice without --yes, after the cut", async () => {
    const r = await withMusic();
    const paid: TtsProvider = { id: "test", speak: (t, v) => fakeProvider().speak(t, v) };
    const logs: string[] = [];
    const err = await makeTake(r.ref, r.project, r.mission, { provider: paid, log: (m) => logs.push(m) }).catch((e) => e);
    expect(err.code).toBe(4);
    expect(existsSync(join(r.ref.dir, "cut.mp4"))).toBe(true);
    expect(logs[0]).toMatch(/would spend/);
  }, 600_000);
});

describe("reel new", () => {
  it("makes a project and a mission that load", async () => {
    const dir = studioCopy();
    const studio = await loadStudio(dir);
    await createProject(studio, "guild", { name: "Guild", base: "http://localhost:3000" });
    const project = await loadProject(await loadStudio(dir), "guild");
    await createMission(project, "first", { title: "Guild: a first look" });
    const mission = await loadMission(project, "first");
    expect(mission.file.title).toBe("Guild: a first look");
    await expect(createMission(project, "first", { title: "x" })).rejects.toThrow(/already/);
  });
});
