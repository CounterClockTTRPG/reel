import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEffects, renderCard } from "../../src/library/effects.js";
import { loadMusic, pickTrack, scanMusic } from "../../src/library/music.js";
import { loadVoices } from "../../src/library/voices.js";
import { loadStudio } from "../../src/model/load.js";
import { writeYamlPreserving } from "../../src/util/yamlfile.js";
import { run } from "../../src/util/proc.js";
import { FIXTURE_STUDIO, studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

async function tone(file: string, title: string) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", "-metadata", `title=${title}`,
    "-metadata", "artist=Monument Studios", file]);
}

describe("music library", () => {
  it("adds new tracks, marks vanished ones missing and keeps hand-edited moods", async () => {
    const dir = studioCopy();
    const music = tmp("reel-music-");
    writeFileSync(join(dir, "studio.yaml"), `music_root: ${music}\ndefault_licence: CC BY 4.0\ndefault_attribution: x\n`);
    writeFileSync(join(dir, "library/music.yaml"), "tracks: []\n");
    await tone(join(music, "Alliance B.mp3"), "Alliance B");
    await tone(join(music, "Enclave.mp3"), "Enclave");
    const studio = await loadStudio(dir);
    expect((await scanMusic(studio)).added).toHaveLength(2);
    const lib = await loadMusic(studio);
    const alliance = lib.tracks.find((t) => t.file === "Alliance B.mp3")!;
    expect(alliance).toMatchObject({ id: "alliance-b", title: "Alliance B", artist: "Monument Studios", licence: "CC BY 4.0" });
    await writeYamlPreserving(join(dir, "library/music.yaml"), (doc) => doc.setIn(["tracks", 0, "moods"], ["calm"]));
    rmSync(join(music, "Enclave.mp3"));
    const second = await scanMusic(studio);
    expect(second.missing).toEqual(["enclave"]);
    const after = await loadMusic(studio);
    expect(after.tracks.find((t) => t.id === "enclave")?.missing).toBe(true);
    expect(after.tracks[0].moods).toEqual(["calm"]);
  });

  it("picks an unused track for a mood before a used one", async () => {
    const lib = await loadMusic(await loadStudio(FIXTURE_STUDIO));
    const opts = { preferMoods: ["fantasy", "calm"], used: new Set<string>() };
    expect(pickTrack(lib, { ...opts, mood: "calm" }).id).toBe("calm-a");
    expect(pickTrack(lib, { ...opts, mood: "calm", used: new Set(["calm-a"]) }).id).toBe("calm-b");
    expect(() => pickTrack(lib, { ...opts, mood: "sad" })).toThrow(/no track for mood "sad"/);
    expect(pickTrack(lib, { ...opts, file: "epic a.mp3" }).id).toBe("epic-a");
  });
});

describe("voices and effects", () => {
  it("loads the voices and effects of the studio", async () => {
    const studio = await loadStudio(FIXTURE_STUDIO);
    expect((await loadVoices(studio)).voices["wise-lady"].voice).toBe("English_Wiselady");
    const fx = await loadEffects(studio);
    expect(fx.transitions["fade-black"]).toEqual({ kind: "fadeblack", length: 1 });
    expect(Object.keys(fx.cards)).toContain("classic");
  });

  it("renders a card at its size with its slots escaped", async () => {
    const studio = await loadStudio(FIXTURE_STUDIO);
    const fx = await loadEffects(studio);
    const out = join(tmp(), "card.png");
    const html = await renderCard(readFileSync(fx.cards.classic, "utf8"), { title: "A <b> card", text: "Hello" },
      { width: 1920, height: 1080 }, out);
    const png = readFileSync(out);
    expect(png.readUInt32BE(16)).toBe(1920);
    expect(png.readUInt32BE(20)).toBe(1080);
    expect(html).toContain("A &lt;b&gt; card");
  });
});
