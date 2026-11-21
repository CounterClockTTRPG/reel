import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeDuration, run } from "../../src/util/proc.js";
import { tmp } from "../helpers/tmp.js";

describe("proc", () => {
  it("probes the duration of a file whose name has a space", async () => {
    const file = join(tmp(), "a b.mp3");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", file]);
    expect(Math.abs((await probeDuration(file)) - 1)).toBeLessThan(0.05);
  });

  it("names the file when a command fails", async () => {
    await expect(run("ffmpeg", ["-i", "missing file.mp3"])).rejects.toThrow(/missing file\.mp3/);
  });
});
