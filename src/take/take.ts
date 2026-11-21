// A take: one numbered assembly of a mission, saying which recording is used for each scene, with everything made
// from it (checks, cut, voice, mix, package) and its review, in ~/.reel/takes/<project>/<mission>/<n>/.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { missionScenes, type Mission } from "../model/load.js";
import { effectiveStyle } from "../model/style.js";
import { sceneKey } from "../record/cache.js";
import { ReelError, takeDir, vaultDir } from "../paths.js";

export interface TakeScene {
  id: string;
  chapter: string;
  recording: string;
  key: string;
}

export interface TakeJson {
  n: number;
  project: string;
  mission: string;
  made: string;
  by: string;
  scenes: TakeScene[];
  files: Record<string, string>;
  music?: Record<string, string>;
}

export interface SceneReview {
  state: "approved" | "flagged";
  note?: string;
  at: string;
  by: "owner" | "claude";
}

export interface ReviewJson {
  status: "draft" | "approved" | "published";
  scenes: Record<string, SceneReview>;
}

export interface TakeRef {
  project: string;
  mission: string;
  n: number;
  dir: string;
}

export const takesRoot = (project: string, mission: string) => join(vaultDir(), "takes", project, mission);

export function takeRef(project: string, mission: string, n: number): TakeRef {
  return { project, mission, n, dir: takeDir(project, mission, n) };
}

export function takeNumbers(project: string, mission: string): number[] {
  const root = takesRoot(project, mission);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => /^\d+$/.test(d) && existsSync(join(root, d, "take.json")))
    .map(Number)
    .sort((a, b) => a - b);
}

export function readTake(ref: TakeRef): TakeJson {
  const file = join(ref.dir, "take.json");
  if (!existsSync(file)) throw new ReelError(2, `no take ${ref.project}/${ref.mission}/${ref.n}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeTake(ref: TakeRef, take: TakeJson): void {
  writeFileSync(join(ref.dir, "take.json"), JSON.stringify(take, null, 2));
}

export function readReview(ref: TakeRef): ReviewJson {
  const file = join(ref.dir, "review.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { status: "draft", scenes: {} };
}

export function writeReview(ref: TakeRef, review: ReviewJson): void {
  writeFileSync(join(ref.dir, "review.json"), JSON.stringify(review, null, 2));
}

/** Hashes of the mission's files, so a take says which words it was made from. */
export function missionFileHashes(mission: Mission): Record<string, string> {
  const files = [join(mission.dir, "mission.yaml"), ...mission.chapters.map((c) => c.path)];
  const td = join(mission.dir, "translations");
  if (existsSync(td)) files.push(...readdirSync(td).map((f) => join(td, f)));
  return Object.fromEntries(
    files.map((f) => [relative(mission.dir, f).replaceAll("\\", "/"), createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16)]),
  );
}

/**
 * A new take of `mission` from these scene recordings, numbered after the last one. The review of a scene whose
 * recording is the same as in `prev` is carried over; the review of a retaken or vanished scene is not.
 */
export function createTake(mission: Mission, scenes: TakeScene[], prev?: TakeRef | null, by = "reel record"): TakeRef {
  const project = mission.project.key;
  const n = (takeNumbers(project, mission.key).at(-1) ?? 0) + 1;
  const ref = takeRef(project, mission.key, n);
  mkdirSync(ref.dir, { recursive: true });
  writeTake(ref, { n, project, mission: mission.key, made: new Date().toISOString(), by, scenes, files: missionFileHashes(mission) });
  const carried: ReviewJson["scenes"] = {};
  if (prev) {
    const before = new Map(readTake(prev).scenes.map((sc) => [sc.id, sc.recording]));
    for (const [id, review] of Object.entries(readReview(prev).scenes)) {
      const now = scenes.find((sc) => sc.id === id);
      if (now && before.get(id) === now.recording) carried[id] = review;
    }
  }
  writeReview(ref, { status: "draft", scenes: carried });
  return ref;
}

export function setSceneReview(ref: TakeRef, scene: string, state: SceneReview["state"] | null, note: string | undefined, by: SceneReview["by"]): ReviewJson {
  const take = readTake(ref);
  if (!take.scenes.some((sc) => sc.id === scene)) throw new ReelError(2, `take ${ref.project}/${ref.mission}/${ref.n} has no scene "${scene}"`);
  const review = readReview(ref);
  if (state === null) delete review.scenes[scene];
  else review.scenes[scene] = { state, ...(note ? { note } : {}), at: new Date().toISOString(), by };
  writeReview(ref, review);
  return review;
}

export function setTakeStatus(ref: TakeRef, status: ReviewJson["status"]): ReviewJson {
  readTake(ref);
  const review = readReview(ref);
  review.status = status;
  writeReview(ref, review);
  return review;
}

/**
 * The scenes of a take that no longer match the mission: their words or steps changed since (their key differs), or
 * a scene they `need` was recorded after them. Scenes the take lacks count as stale too.
 */
export function staleScenes(mission: Mission, ref: TakeRef, adapterVersion: string): string[] {
  const take = readTake(ref);
  const { style } = effectiveStyle(mission.project, mission);
  const byId = new Map(take.scenes.map((sc) => [sc.id, sc]));
  const stale: string[] = [];
  for (const { scene } of missionScenes(mission)) {
    const used = byId.get(scene.id);
    if (!used || used.key !== sceneKey(scene, adapterVersion, mission.project.file.app.base, style.size)) {
      stale.push(scene.id);
      continue;
    }
    if (scene.needs.some((need) => (byId.get(need)?.recording ?? "") > used.recording)) stale.push(scene.id);
  }
  return stale;
}

export interface TakeSummary {
  n: number;
  made: string;
  status: ReviewJson["status"];
  flagged: number;
  approved: number;
  scenes: number;
}

export async function listTakes(project: string, mission: string): Promise<TakeSummary[]> {
  return takeNumbers(project, mission).map((n) => {
    const ref = takeRef(project, mission, n);
    const take = readTake(ref);
    const review = readReview(ref);
    const states = Object.values(review.scenes);
    return {
      n,
      made: take.made,
      status: review.status,
      flagged: states.filter((s) => s.state === "flagged").length,
      approved: states.filter((s) => s.state === "approved").length,
      scenes: take.scenes.length,
    };
  });
}

/** `project/mission/n`, or `project/mission` for its latest take. */
export function parseTakeRef(s: string): TakeRef {
  const parts = s.split("/");
  if (parts.length < 2 || parts.length > 3) throw new ReelError(2, `"${s}" is not a take (project/mission or project/mission/n)`);
  const [project, mission, n] = parts;
  if (n !== undefined) {
    if (!/^\d+$/.test(n)) throw new ReelError(2, `"${s}": a take number is a number`);
    return takeRef(project, mission, Number(n));
  }
  const last = takeNumbers(project, mission).at(-1);
  if (last === undefined) throw new ReelError(2, `${project}/${mission} has no takes yet: run \`reel record ${project}/${mission}\``);
  return takeRef(project, mission, last);
}
