import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cutTake } from "../../src/edit/join.js";
import { probeDuration, run } from "../../src/util/proc.js";
import { readTake } from "../../src/take/take.js";
import { recordedTake } from "../helpers/recorded.js";

describe("joining a take", () => {
  it("writes a video as long as the plan, with chapters, and the music chosen into the take", async () => {
    const { project, mission, ref } = await recordedTake();
    const { file, plan } = await cutTake(ref, project, mission);
    expect(Math.abs((await probeDuration(file)) - plan.total)).toBeLessThan(0.2);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_chapters", "-of", "json", file]);
    expect(JSON.parse(stdout).chapters.length).toBeGreaterThanOrEqual(1);
    expect(readTake(ref).music).toEqual({ intro: "calm-a", search: "calm-a", result: "calm-a" });
    expect(plan.segments.at(-1)!.card?.text).toBe("Calm A by Tester");
    expect(existsSync(join(ref.dir, "chapters.vtt"))).toBe(true);
  }, 300_000);
});
