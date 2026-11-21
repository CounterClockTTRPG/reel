import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { effectiveStyle } from "../../src/model/style.js";
import { studioCopy } from "../helpers/studio.js";

async function load(missionStyle: string) {
  const dir = studioCopy();
  writeFileSync(join(dir, "projects/demo/missions/tour/mission.yaml"),
    `title: T\nopening: { title: T }\nchapters: [01-basics]\n${missionStyle}`);
  const project = await loadProject(await loadStudio(dir), "demo");
  return { project, mission: await loadMission(project, "tour") };
}

describe("effective style", () => {
  it("lets a mission replace a list and keep the project's other keys", async () => {
    const { project, mission } = await load("style:\n  music: { moods: [epic] }\n");
    const { style, sources } = effectiveStyle(project, mission);
    expect(style.music.moods).toEqual(["epic"]);
    expect(sources["music.moods"]).toBe("mission");
    expect(style.music.loudness).toBe(-33);
    expect(sources["music.loudness"]).toBe("project");
  });

  it("falls back to the defaults", async () => {
    const { project, mission } = await load("");
    const { style, sources } = effectiveStyle(project, mission);
    expect(style.loudness.voice).toBe(-16);
    expect(sources["loudness.voice"]).toBe("default");
  });
});
