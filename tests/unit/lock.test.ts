import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lockFile, withMissionLock } from "../../src/jobs/lock.js";
import { tmp } from "../helpers/tmp.js";

describe("mission lock", () => {
  it("refuses a second holder while the first is alive", async () => {
    process.env.REEL_DATA = tmp();
    await withMissionLock("demo", "tour", async () => {
      await expect(withMissionLock("demo", "tour", async () => {})).rejects.toThrow(/being recorded by pid/);
    });
  });

  it("takes over a lock whose process is gone", async () => {
    process.env.REEL_DATA = tmp();
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    mkdirSync(join(process.env.REEL_DATA, "locks"), { recursive: true });
    writeFileSync(lockFile("demo", "tour"), JSON.stringify({ pid: dead, host: "x", started: "y" }));
    const warnings: string[] = [];
    expect(await withMissionLock("demo", "tour", async () => 7, (m) => warnings.push(m))).toBe(7);
    expect(warnings.join()).toMatch(/took over/);
  });
});
