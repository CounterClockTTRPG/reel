import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadMission, loadProject, loadStudio, type Mission } from "../../src/model/load.js";
import { createTake, parseTakeRef, readReview, setSceneReview, staleScenes, type TakeScene } from "../../src/take/take.js";
import { sceneKey } from "../../src/record/cache.js";
import { effectiveStyle } from "../../src/model/style.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const CHAPTER = "projects/demo/missions/tour/chapters/01-basics.yaml";
let dir: string;

async function tour(): Promise<Mission> {
  const project = await loadProject(await loadStudio(dir), "demo");
  return loadMission(project, "tour");
}

/** Fake recordings (no video): recording.json files with the scenes' current keys and the given times. */
function fake(mission: Mission, recordings: Record<string, string>): TakeScene[] {
  const { style } = effectiveStyle(mission.project, mission);
  return mission.chapters[0].file.scenes.map((scene) => {
    const key = sceneKey(scene, "1.0.0", mission.project.file.app.base, style.size);
    const id = recordings[scene.id];
    const d = join(process.env.REEL_DATA!, "scenes/demo/tour", scene.id, id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "recording.json"), JSON.stringify({ id, scene: scene.id, key, made: id, duration: 1, seats: [] }));
    return { id: scene.id, chapter: "01-basics", recording: id, key };
  });
}

beforeEach(() => {
  process.env.REEL_DATA = tmp("reel-vault-");
  dir = studioCopy();
});

describe("takes", () => {
  it("carries a flag to the next take when its scene wasn't retaken, and drops it when it was", async () => {
    const m = await tour();
    const t1 = createTake(m, fake(m, { intro: "a1", search: "b1", result: "c1" }));
    setSceneReview(t1, "search", "flagged", "too fast", "owner");
    setSceneReview(t1, "intro", "approved", undefined, "owner");
    const t2 = createTake(m, fake(m, { intro: "a1", search: "b2", result: "c1" }), t1);
    const review = readReview(t2);
    expect(review.scenes.intro?.state).toBe("approved");
    expect(review.scenes.search).toBeUndefined();
  });

  it("drops the review of a scene that no longer exists", async () => {
    const m = await tour();
    const t1 = createTake(m, fake(m, { intro: "a1", search: "b1", result: "c1" }));
    setSceneReview(t1, "result", "approved", undefined, "owner");
    const file = join(dir, CHAPTER);
    const { readFileSync } = await import("node:fs");
    writeFileSync(file, readFileSync(file, "utf8").replace("id: result", "id: answer"));
    const m2 = await tour();
    const t2 = createTake(m2, fake(m2, { intro: "a1", search: "b1", answer: "c1" }), t1);
    expect(Object.keys(readReview(t2).scenes)).toEqual([]);
  });

  it("marks a scene stale when a scene it needs was retaken after it", async () => {
    const m = await tour();
    const t = createTake(m, fake(m, { intro: "2026-01-01", search: "2026-01-03", result: "2026-01-02" }));
    expect(staleScenes(m, t, "1.0.0")).toEqual(["result"]);
  });

  it("marks a scene stale when its words changed since the take", async () => {
    const m = await tour();
    const t = createTake(m, fake(m, { intro: "a", search: "b", result: "c" }));
    const file = join(dir, CHAPTER);
    const { readFileSync } = await import("node:fs");
    writeFileSync(file, readFileSync(file, "utf8").replace("This is the home page.", "Welcome home."));
    expect(staleScenes(await tour(), t, "1.0.0")).toEqual(["intro"]);
  });

  it("names the latest take by project/mission", async () => {
    const m = await tour();
    createTake(m, fake(m, { intro: "a", search: "b", result: "c" }));
    createTake(m, fake(m, { intro: "a", search: "b", result: "c" }));
    expect(parseTakeRef("demo/tour").n).toBe(2);
    expect(parseTakeRef("demo/tour/1").n).toBe(1);
  });
});
