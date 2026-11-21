import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setTranslation, sourceLines, translationStatus } from "../../src/i18n/translations.js";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { studioCopy } from "../helpers/studio.js";

const CHAPTER = "projects/demo/missions/tour/chapters/01-basics.yaml";
let dir: string;
const tour = async () => loadMission(await loadProject(await loadStudio(dir), "demo"), "tour");

beforeEach(() => {
  dir = studioCopy();
});

describe("translations", () => {
  it("lists the narrator's lines by key", async () => {
    expect(sourceLines(await tour())).toEqual({
      opening: "This is the demo app.",
      "intro/0": "This is the home page.",
      "search/0": "The answer is in.",
      "result/0": "Every answer is kept, forever.",
    });
  });

  it("reports missing lines, then a translation stale once its source changes", async () => {
    expect(translationStatus(await tour(), "nl").missing).toHaveLength(4);
    await setTranslation(await tour(), "nl", "intro/0", "Dit is de startpagina.");
    expect(translationStatus(await tour(), "nl").ok["intro/0"]).toBe("Dit is de startpagina.");
    const file = join(dir, CHAPTER);
    writeFileSync(file, readFileSync(file, "utf8").replace("This is the home page.", "This is where it starts."));
    expect(translationStatus(await tour(), "nl").stale).toEqual(["intro/0"]);
  });

  it("reports a translation whose scene is gone as orphaned", async () => {
    await setTranslation(await tour(), "nl", "intro/0", "Dit is de startpagina.");
    const file = join(dir, CHAPTER);
    writeFileSync(file, readFileSync(file, "utf8").replace("id: intro", "id: welcome"));
    const status = translationStatus(await tour(), "nl");
    expect(status.orphaned).toEqual(["intro/0"]);
    expect(status.missing).toContain("welcome/0");
  });
});
