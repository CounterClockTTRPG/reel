import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPrivacy } from "../../src/check/privacy.js";
import { recordedTake } from "../helpers/recorded.js";

describe("privacy check", () => {
  it("finds a private string on screen when nothing masks it", async () => {
    const { project, mission, ref } = await recordedTake("unmasked");
    const result = await checkPrivacy(ref, project, mission);
    expect(result.ok).toBe(false);
    expect(result.hits.some((h) => h.scene === "intro" && h.match === "secret@example.com")).toBe(true);
  }, 300_000);

  it("passes a take whose private element was masked, and keeps a frame per caption", async () => {
    const { project, mission, ref } = await recordedTake("plain");
    const result = await checkPrivacy(ref, project, mission);
    expect(result.hits).toEqual([]);
    expect(result.ok).toBe(true);
    expect(existsSync(join(ref.dir, "frames", "intro-0.png"))).toBe(true);
    expect(existsSync(join(ref.dir, "checks", "privacy.json"))).toBe(true);
  }, 300_000);
});

describe("frames by scene", () => {
  it("doesn't take another scene's frames for this scene's", async () => {
    const { framesOf } = await import("../../src/check/privacy.js");
    expect(framesOf(["a-s0001.png", "a-setup-s0001.png", "a-c0.png", "a-s0002.png"], "a")).toEqual(["a-s0001.png", "a-s0002.png"]);
  });
});
