import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadMission, loadProject, loadStudio } from "../../src/model/load.js";
import { sceneKey } from "../../src/record/cache.js";
import { recordMission } from "../../src/record/recorder.js";
import { listTakes } from "../../src/take/take.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { studioCopy } from "../helpers/studio.js";
import { tmp } from "../helpers/tmp.js";

const CHAPTER = "projects/demo/missions/tour/chapters/01-basics.yaml";
let dir: string;

async function tour() {
  const project = await loadProject(await loadStudio(dir), "demo");
  return { project, mission: await loadMission(project, "tour") };
}
const quiet = { log: () => {}, actionTimeout: 2000 };

beforeAll(async () => {
  await serveFixtureApp();
  process.env.REEL_DATA = tmp("reel-vault-");
  dir = studioCopy();
});

describe("recording a mission", () => {
  it("records every scene the first time and makes take 1", async () => {
    const result = await recordMission({ ...(await tour()), ...quiet });
    expect(result.recorded).toEqual(["intro", "search", "result"]);
    expect(result.take?.n).toBe(1);
    const take = JSON.parse(readFileSync(join(result.take!.dir, "take.json"), "utf8"));
    const intro = take.scenes.find((s: { id: string }) => s.id === "intro");
    const sceneDir = join(process.env.REEL_DATA!, "scenes/demo/tour/intro", intro.recording);
    expect(existsSync(join(sceneDir, "video.mp4"))).toBe(true);
    expect(JSON.parse(readFileSync(join(sceneDir, "timeline.json"), "utf8")).events.some((e: { kind: string }) => e.kind === "say")).toBe(true);
  }, 120_000);

  it("retakes one scene and reuses the others", async () => {
    const result = await recordMission({ ...(await tour()), scenes: ["search"], ...quiet });
    expect(result.recorded).toEqual(["search"]);
    expect(result.reused).toEqual(["intro", "result"]);
    expect(result.take?.n).toBe(2);
  }, 120_000);

  it("keeps a scene's key when only its music or speed changes", async () => {
    const { mission } = await tour();
    const scene = mission.chapters[0].file.scenes[0];
    const size = { width: 1, height: 1 };
    expect(sceneKey({ ...scene, music: "epic", speed: 3, title: "New" }, "1.0.0", "http://x", size)).toBe(sceneKey(scene, "1.0.0", "http://x", size));
  });

  it("records only the scene whose words changed", async () => {
    const { mission } = await tour();
    const before = sceneKey(mission.chapters[0].file.scenes[2], "1.0.0", "http://x", { width: 1, height: 1 });
    const file = join(dir, CHAPTER);
    writeFileSync(file, readFileSync(file, "utf8").replace("Every answer is kept.", "Every answer stays."));
    const changed = await tour();
    expect(sceneKey(changed.mission.chapters[0].file.scenes[2], "1.0.0", "http://x", { width: 1, height: 1 })).not.toBe(before);
    const result = await recordMission({ ...changed, ...quiet });
    expect(result.recorded).toEqual(["result"]);
    expect((await listTakes("demo", "tour")).map((t) => t.n)).toEqual([1, 2, 3]);
  }, 120_000);

  for (const dry of [false, true]) {
    it(`fails a missing element with the scene and a screenshot${dry ? " in a dry run" : ""}`, async () => {
      const file = join(dir, CHAPTER);
      const text = readFileSync(file, "utf8");
      writeFileSync(file, text.replace("      - goto: /\n", "      - goto: /\n      - click: \"#missing\"\n"));
      try {
        const err = await recordMission({ ...(await tour()), scenes: ["intro"], dry, ...quiet }).catch((e) => e);
        expect(err.message).toMatch(/scene "intro", step 2 \(click "#missing"\)/);
        expect(existsSync(err.details.screenshot)).toBe(true);
      } finally {
        writeFileSync(file, text);
      }
    }, 120_000);
  }

  it("runs a dry run without making a take", async () => {
    const before = (await listTakes("demo", "tour")).length;
    const result = await recordMission({ ...(await tour()), dry: true, ...quiet });
    expect(result.take).toBeUndefined();
    expect(result.recorded).toEqual(["intro", "search", "result"]);
    expect((await listTakes("demo", "tour")).length).toBe(before);
  }, 120_000);
});
