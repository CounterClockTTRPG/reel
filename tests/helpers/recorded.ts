// A recorded take of the fixture mission, made once and kept in a cache keyed by the fixture and the recorder's code,
// so tests of the steps after recording don't each record again. Each call gets its own copy.
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMission, loadProject, loadStudio, type Mission, type Project } from "../../src/model/load.js";
import { recordMission } from "../../src/record/recorder.js";
import { takeRef, type TakeRef } from "../../src/take/take.js";
import { serveFixtureApp } from "./serve.js";
import { studioCopy } from "./studio.js";
import { tmp } from "./tmp.js";

const ROOT = join(import.meta.dirname, "..", "..");

function hashTree(dir: string, h = createHash("sha256")) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) hashTree(p, h);
    else h.update(f).update(readFileSync(p));
  }
  return h;
}

export interface Recorded {
  studio: string;
  vault: string;
  project: Project;
  mission: Mission;
  ref: TakeRef;
}

/** `variant` changes the studio before recording: "plain", or "unmasked" (the private element shown). */
export async function recordedTake(variant: "plain" | "unmasked" = "plain"): Promise<Recorded> {
  const h = hashTree(join(ROOT, "tests", "fixtures"));
  hashTree(join(ROOT, "src", "record"), h);
  const cache = join(tmpdir(), "reel-test-cache", `${variant}-${h.digest("hex").slice(0, 12)}`);
  if (!existsSync(join(cache, "done"))) {
    rmSync(cache, { recursive: true, force: true });
    await serveFixtureApp();
    const studio = studioCopy();
    if (variant === "unmasked") {
      const file = join(studio, "projects/demo/project.yaml");
      writeFileSync(file, readFileSync(file, "utf8").replace('masks: [".private"]', "masks: []"));
    }
    const before = process.env.REEL_DATA;
    process.env.REEL_DATA = join(cache, "vault");
    const project = await loadProject(await loadStudio(studio), "demo");
    await recordMission({ project, mission: await loadMission(project, "tour"), log: () => {} });
    process.env.REEL_DATA = before;
    cpSync(studio, join(cache, "studio"), { recursive: true });
    writeFileSync(join(cache, "done"), "");
  }
  const base = tmp("reel-recorded-");
  cpSync(join(cache, "studio"), join(base, "studio"), { recursive: true });
  cpSync(join(cache, "vault"), join(base, "vault"), { recursive: true });
  process.env.REEL_DATA = join(base, "vault");
  const project = await loadProject(await loadStudio(join(base, "studio")), "demo");
  return { studio: join(base, "studio"), vault: join(base, "vault"), project, mission: await loadMission(project, "tour"), ref: takeRef("demo", "tour", 1) };
}
