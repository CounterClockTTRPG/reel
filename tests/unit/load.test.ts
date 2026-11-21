import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilmError, loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { FIXTURE_STUDIO, studioCopy } from "../helpers/studio.js";

const CHAPTER = "projects/demo/missions/tour/chapters/01-basics.yaml";

async function tour(dir = FIXTURE_STUDIO) {
  const studio = await loadStudio(dir);
  return loadMission(await loadProject(studio, "demo"), "tour");
}

describe("loading a studio", () => {
  it("lists projects and their missions", async () => {
    const studio = await loadStudio(FIXTURE_STUDIO);
    expect(studio.projects).toEqual([{ key: "demo", name: "Demo", missions: ["tour"] }]);
  });

  it("loads a mission's chapters and scenes", async () => {
    const m = await tour();
    expect(m.chapters).toHaveLength(1);
    expect(m.chapters[0].file.scenes.map((s) => s.id)).toEqual(["intro", "search", "result"]);
  });

  it("keeps both the caption and the spoken line of a say", async () => {
    const m = await tour();
    expect(m.chapters[0].file.scenes[2].steps[0]).toEqual({
      say: { text: "Every answer is kept.", spoken: "Every answer is kept, forever." },
    });
  });

  it("fails on an unknown core step with its file and line", async () => {
    const dir = studioCopy();
    const file = join(dir, CHAPTER);
    writeFileSync(file, "title: X\nscenes:\n  - id: a\n    steps:\n      - goto: /\n      - clik: '#go'\n");
    const err = await tour(dir).catch((e) => e);
    expect(err).toBeInstanceOf(FilmError);
    expect(err.message).toMatch(/01-basics\.yaml:6 \(scene "a"\).*unknown step "clik"/);
  });

  it("accepts an adapter step without knowing it", async () => {
    const m = await tour();
    expect(m.chapters[0].file.scenes[1].steps[1]).toEqual({ "demo.act": { as: "answer" } });
  });

  it("parses parallel steps", async () => {
    const dir = studioCopy();
    writeFileSync(join(dir, CHAPTER), "title: X\nscenes:\n  - id: a\n    steps:\n      - parallel:\n" +
      "          - [{ type: { target: '#q', text: a }, seat: ana }]\n          - [{ type: { target: '#q', text: b }, seat: ben }]\n");
    const m = await tour(dir);
    expect((m.chapters[0].file.scenes[0].steps[0] as { parallel: unknown[] }).parallel).toHaveLength(2);
  });

  it("fails on a scene id used twice, naming both files", async () => {
    const dir = studioCopy();
    writeFileSync(join(dir, "projects/demo/missions/tour/chapters/02-more.yaml"),
      "title: More\nscenes:\n  - id: intro\n    steps: [{ goto: / }]\n");
    writeFileSync(join(dir, "projects/demo/missions/tour/mission.yaml"),
      "title: T\nopening: { title: T }\nchapters: [01-basics, 02-more]\n");
    const err = await tour(dir).catch((e) => e);
    expect(err).toBeInstanceOf(FilmError);
    expect(err.message).toMatch(/01-basics\.yaml/);
    expect(err.message).toMatch(/02-more\.yaml/);
  });
});
