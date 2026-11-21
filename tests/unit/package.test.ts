import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cutTake } from "../../src/edit/join.js";
import { setTranslation, sourceLines } from "../../src/i18n/translations.js";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { packageTake } from "../../src/pub/package.js";
import { mixTake } from "../../src/sound/mix.js";
import { fakeProvider } from "../../src/sound/tts.js";
import { voiceTake } from "../../src/sound/voice.js";
import { run } from "../../src/util/proc.js";
import { recordedTake, type Recorded } from "../helpers/recorded.js";

let r: Recorded;
const reload = async () => {
  const project = await loadProject(await loadStudio(r.studio), "demo");
  return { project, mission: await loadMission(project, "tour") };
};

beforeAll(async () => {
  r = await recordedTake();
  mkdirSync(join(r.studio, "music"), { recursive: true });
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:a=0.3", "-ar", "44100", "-ac", "2", join(r.studio, "music", "calm-a.mp3")]);
  await cutTake(r.ref, r.project, r.mission);
  mkdirSync(join(r.ref.dir, "checks"), { recursive: true });
  writeFileSync(join(r.ref.dir, "checks", "privacy.json"), JSON.stringify({ ok: true, hits: [] }));
  await voiceTake(r.ref, r.project, r.mission, { yes: true, provider: fakeProvider() });
  await mixTake(r.ref, r.project, r.mission);
}, 600_000);

describe("the YouTube package", () => {
  it("refuses a language with missing translations, naming the lines", async () => {
    const { project, mission } = await reload();
    const err = await packageTake(r.ref, project, mission).catch((e) => e);
    expect(err.code).toBe(3);
    expect(err.message).toMatch(/nl.*intro\/0/);
  }, 120_000);

  it("writes the video, subtitles, chapters, description and thumbnail", async () => {
    const before = await reload();
    for (const [key, text] of Object.entries(sourceLines(before.mission))) await setTranslation(before.mission, "nl", key, `NL: ${text}`);
    const { project, mission } = await reload();
    const { dir } = await packageTake(r.ref, project, mission);
    for (const f of ["video.mp4", "en.srt", "nl.srt", "chapters.txt", "chapters.vtt", "description.md", "thumbnail.png"]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const chapters = readFileSync(join(dir, "chapters.txt"), "utf8").trim().split("\n");
    expect(chapters[0]).toMatch(/^0:00 /);
    const seconds = chapters.map((l) => l.split(" ")[0].split(":").reduce((n, p) => n * 60 + Number(p), 0));
    expect([...seconds].sort((a, b) => a - b)).toEqual(seconds);
    const lines = JSON.parse(readFileSync(join(r.ref.dir, "voice", "lines.json"), "utf8")).lines;
    const intro = lines.find((l: { key: string }) => l.key === "intro/0");
    const srt = readFileSync(join(dir, "en.srt"), "utf8");
    const at = new Date(Math.round(intro.at * 1000)).toISOString().slice(11, 23).replace(".", ",");
    expect(srt).toContain(`${at} --> `);
    expect(readFileSync(join(dir, "nl.srt"), "utf8")).toContain("NL: This is the home page.");
    const png = readFileSync(join(dir, "thumbnail.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 720]);
    expect(readFileSync(join(dir, "description.md"), "utf8")).toContain("Calm A by Tester");
  }, 120_000);
});
