// Recording a mission scene by scene: each scene in fresh contexts (the host's and each seat's it names), its own
// video and timeline, kept in the vault and reused while its key is unchanged. A real run makes a new take; a dry run
// clicks through without calling anything that costs money or changes state, and makes none.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StageLike } from "../adapter/api.js";
import { loadAdapter } from "../adapter/load.js";
import { secretsFor } from "../adapter/secrets.js";
import { loadEffects } from "../library/effects.js";
import { missionScenes, sayIndexes, type Chapter, type Mission, type Project } from "../model/load.js";
import type { Scene, Step } from "../model/schema.js";
import { effectiveStyle } from "../model/style.js";
import { ReelError, sceneDir, vaultDir } from "../paths.js";
import { withMissionLock } from "../jobs/lock.js";
import { resetApp, withApp } from "../app/serve.js";
import { isSeeded, seedApp } from "../app/seed.js";
import { probeDuration, run } from "../util/proc.js";
import { createTake, readReview, takeNumbers, takeRef, type TakeRef, type TakeScene } from "../take/take.js";
import { cachedRecording, newRecordingId, sceneKey, type RecordingInfo } from "./cache.js";
import { openSession, type SceneStage, type Session } from "./session.js";
import { StateBag, stateFile } from "./state.js";
import { runSteps, seatsIn } from "./steps.js";

export interface RecordOptions {
  project: Project;
  mission: Mission;
  scenes?: string[];
  flagged?: boolean;
  all?: boolean;
  dry?: boolean;
  headed?: boolean;
  /** Starts the project's app data over first (app.serve): see resetApp. */
  fresh?: boolean;
  actionTimeout?: number;
  log: (msg: string) => void;
}

export interface RecordResult {
  take?: TakeRef;
  recorded: string[];
  reused: string[];
  skippedDry: string[];
}

/** The `as` keys a scene's steps keep in the state bag. */
function keysKept(steps: Step[]): string[] {
  return steps.flatMap((s) => {
    if (typeof s === "string") return [];
    const own = s.as ? [s.as] : [];
    return Array.isArray(s.parallel) ? [...own, ...(s.parallel as Step[][]).flatMap(keysKept)] : own;
  });
}

export async function recordMission(opts: RecordOptions): Promise<RecordResult> {
  const { project, mission } = opts;
  const all = missionScenes(mission);
  for (const id of opts.scenes ?? []) {
    if (!all.some((s) => s.scene.id === id)) throw new ReelError(2, `no scene "${id}" in ${project.key}/${mission.key}`);
  }
  const withServed = (fn: () => Promise<RecordResult>) =>
    project.file.app.serve ? withApp(project, () => fn(), opts.log) : fn();
  const go = async () => {
    if (project.file.app.serve && !isSeeded(project.key)) {
      const adapter = await loadAdapter(project.file.adapter, project.dir);
      if (adapter?.seed) await seedApp(project, opts.log);
    }
    return withServed(() => record(opts, all));
  };
  if (opts.fresh) {
    if (!project.file.app.serve) throw new ReelError(2, `--fresh starts an app's data over: project ${project.key} has no app.serve`);
    await resetApp(project);
    opts.log(`  ${project.key}'s app data starts over`);
  }
  return opts.dry ? go() : withMissionLock(project.key, mission.key, go, opts.log);
}

async function record(opts: RecordOptions, all: { chapter: Chapter; scene: Scene }[]): Promise<RecordResult> {
  const { project, mission, log } = opts;
  const { style } = effectiveStyle(project, mission);
  const adapter = await loadAdapter(project.file.adapter, project.dir);
  const options = checkedOptions(project, adapter);
  const effects = await loadEffects(project.studio);
  const overlayFile = effects.overlays[style.overlay];
  if (!overlayFile) throw new ReelError(1, `no overlay "${style.overlay}" in library/effects/overlays/`);
  const overlayCss = readFileSync(overlayFile, "utf8");

  const last = takeNumbers(project.key, mission.key).at(-1);
  const prevRef = last !== undefined ? takeRef(project.key, mission.key, last) : null;
  const flagged = new Set(
    opts.flagged && prevRef
      ? Object.entries(readReview(prevRef).scenes).filter(([, r]) => r.state === "flagged").map(([id]) => id)
      : [],
  );

  const keyOf = (scene: Scene) => sceneKey(scene, adapter?.version ?? "", project.file.app.base, style.size);
  const plan = all.map(({ chapter, scene }) => {
    const key = keyOf(scene);
    const cached = cachedRecording(project.key, mission.key, scene.id, key);
    const named = opts.scenes?.includes(scene.id) ?? false;
    const wanted = opts.scenes?.length ? named : opts.all || flagged.has(scene.id) || !cached;
    return { chapter, scene, key, cached, record: opts.dry ? (opts.scenes?.length ? named : true) : wanted };
  });

  const state = new StateBag(stateFile(project.key, mission.key));
  const result: RecordResult = { recorded: [], reused: [], skippedDry: [] };
  const used: TakeScene[] = [];
  const session = await openSession({ project, style, adapter, overlayCss, headed: opts.headed, actionTimeout: opts.actionTimeout, log });
  const dryRoot = join(vaultDir(), "dry", project.key, mission.key);
  if (opts.dry) rmSync(dryRoot, { recursive: true, force: true });

  try {
    for (const chapter of mission.chapters) {
      const scenes = plan.filter((p) => p.chapter === chapter);
      const recording = scenes.filter((p) => p.record);
      if (recording.length && chapter.file.setup.length) {
        await backstage(session, chapter.file.setup, `${chapter.key} setup`, { session, options, opts, state, adapter });
      }
      try {
        for (const p of scenes) {
          if (!p.record) {
            if (p.cached) {
              used.push({ id: p.scene.id, chapter: chapter.key, recording: p.cached.id, key: p.key });
              result.reused.push(p.scene.id);
            }
            continue;
          }
          if (opts.dry) {
            const missing = p.scene.needs.flatMap((need) =>
              result.skippedDry.includes(need)
                ? [`${need}'s state`]
                : keysKept(all.find((s) => s.scene.id === need)!.scene.steps).filter((k) => !state.has(k)),
            );
            if (missing.length) {
              log(`  scene ${p.scene.id}: not reachable dry (no ${missing.join(", ")} from a real run yet), skipped`);
              result.skippedDry.push(p.scene.id);
              continue;
            }
          }
          log(`Scene ${p.scene.id}${opts.dry ? " (dry)" : ""}`);
          const id = newRecordingId();
          const out = opts.dry ? join(dryRoot, p.scene.id) : sceneDir(project.key, mission.key, p.scene.id, id);
          const info = await recordScene(session, p.scene, p.key, id, out, { session, options, opts, state, adapter });
          result.recorded.push(p.scene.id);
          used.push({ id: p.scene.id, chapter: chapter.key, recording: info.id, key: p.key });
        }
      } finally {
        if (recording.length && chapter.file.teardown.length) {
          await backstage(session, chapter.file.teardown, `${chapter.key} teardown`, { session, options, opts, state, adapter }).catch((e) =>
            log(`  teardown failed: ${(e as Error).message}`),
          );
        }
      }
    }
  } finally {
    await session.close();
    if (!opts.dry) state.save();
  }
  if (opts.dry) return result;
  const missing = all.filter(({ scene }) => !used.some((u) => u.id === scene.id));
  if (missing.length) throw new ReelError(1, `no recording of ${missing.map((m) => m.scene.id).join(", ")}`);
  result.take = createTake(mission, used, prevRef);
  log(`Take ${project.key}/${mission.key}/${result.take.n}: recorded ${result.recorded.join(", ") || "nothing"}, reused ${result.reused.join(", ") || "nothing"}`);
  return result;
}

/** project.yaml's adapter_options, checked by the adapter's schema (when it has one). */
export function checkedOptions(project: Project, adapter: Awaited<ReturnType<typeof loadAdapter>>): Record<string, unknown> {
  const raw = project.file.adapter_options ?? {};
  if (!adapter?.options) return raw;
  const parsed = adapter.options.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.join(".") || (issue as { keys?: string[] }).keys?.join(", ") || "";
    throw new ReelError(1, `project ${project.key}: adapter_options${where ? `.${where}` : ""}: ${issue.message}`);
  }
  return parsed.data;
}

interface SceneEnv {
  options?: Record<string, unknown>;
  session?: Session;
  opts: RecordOptions;
  state: StateBag;
  adapter: Awaited<ReturnType<typeof loadAdapter>>;
}

/** Setup and teardown: run on a page of their own that is never shown. */
async function backstage(session: Session, steps: Step[], name: string, env: SceneEnv) {
  const out = join(vaultDir(), "tmp", `backstage-${process.pid}`);
  const host = await session.newStage(name, "host", out);
  try {
    await runSteps(steps, context(host.stage, new Map(), name, env));
  } finally {
    await host.finish();
    rmSync(out, { recursive: true, force: true });
  }
}

function context(stage: StageLike, seats: Map<string, StageLike>, scene: string, env: SceneEnv) {
  return {
    stage,
    seat(name: string) {
      const s = seats.get(name);
      if (!s) throw new ReelError(1, `scene "${scene}": no seat "${name}"`);
      return s;
    },
    state: env.state,
    adapter: env.adapter,
    api: env.session?.api,
    secrets: secretsFor(env.opts.project.key),
    options: env.options ?? {},
    dry: Boolean(env.opts.dry),
    scene,
    log: env.opts.log,
  };
}

async function recordScene(session: Session, scene: Scene, key: string, id: string, out: string, env: SceneEnv): Promise<RecordingInfo> {
  mkdirSync(out, { recursive: true });
  const seatNames = seatsIn(scene.steps);
  const host = await session.newStage(scene.id, "host", out);
  const seats = new Map<string, SceneStage>();
  for (const name of seatNames) seats.set(name, await session.newStage(scene.id, name, out));
  if (env.adapter?.init) {
    await env.adapter.init({ page: host.stage.page, state: env.state, seat: "host" });
    for (const [name, s] of seats) await env.adapter.init({ page: s.stage.page, state: env.state, seat: name });
  }
  const stages = new Map([...seats].map(([k, v]) => [k, v.stage as StageLike]));
  let failure: unknown = null;
  try {
    await runSteps(scene.steps, { ...context(host.stage, stages, scene.id, env), says: sayIndexes(scene.steps) });
  } catch (e) {
    failure = e;
    await host.stage.page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  }
  const finished = [await host.finish(), ...(await Promise.all([...seats.values()].map((s) => s.finish())))];
  for (const f of finished) {
    if (f.file && existsSync(f.file)) renameSync(f.file, join(out, `${f.seat === "host" ? "video" : f.seat}.webm`));
  }
  writeFileSync(
    join(out, "timeline.json"),
    JSON.stringify({ scene: scene.id, key, events: finished[0].timeline, seats: Object.fromEntries(finished.slice(1).map((f) => [f.seat, f.timeline])) }, null, 2),
  );
  if (failure) {
    const err = failure instanceof ReelError ? failure : new ReelError(1, `scene "${scene.id}": ${(failure as Error).message}`);
    err.details = { ...err.details, scene: scene.id, screenshot: join(out, "failure.png") };
    throw err;
  }
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(out, "video.webm"), "-c:v", "libx264", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "30", join(out, "video.mp4")]);
  const info: RecordingInfo = {
    id,
    scene: scene.id,
    key,
    made: new Date().toISOString(),
    duration: await probeDuration(join(out, "video.mp4")),
    seats: seatNames,
  };
  writeFileSync(join(out, "recording.json"), JSON.stringify(info, null, 2));
  return info;
}
