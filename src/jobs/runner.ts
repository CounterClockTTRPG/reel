// Jobs the web UI starts (record, dry run, check, cut, voice, mix, package, make): run in the server by the same code
// as the CLI, one at a time per mission, each with a log the page follows live. Recording takes the mission's lock, as
// the CLI does, so the two never record the same mission at once.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { checkPrivacy } from "../check/privacy.js";
import { cutTake } from "../edit/join.js";
import { loadMission, loadProject, loadStudio } from "../model/load.js";
import { ReelError, vaultDir } from "../paths.js";
import { makeTake } from "../pipeline/make.js";
import { packageTake } from "../pub/package.js";
import { recordMission } from "../record/recorder.js";
import { mixTake } from "../sound/mix.js";
import { voiceTake } from "../sound/voice.js";
import { parseTakeRef } from "../take/take.js";

export const JOB_KINDS = ["record", "dry", "check", "cut", "voice", "mix", "package", "make"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface JobArgs {
  scenes?: string[];
  flagged?: boolean;
  all?: boolean;
  yes?: boolean;
  budget?: number;
  force?: boolean;
  allowMissing?: boolean;
}

export interface Job {
  id: string;
  kind: JobKind;
  /** project/mission, or project/mission/n for a take. */
  target: string;
  args: JobArgs;
  status: "queued" | "running" | "ok" | "failed";
  created: string;
  started?: string;
  ended?: string;
  error?: string;
  code?: number;
  result?: unknown;
  log: string[];
}

export class JobRunner {
  private jobs = new Map<string, Job>();
  private queues = new Map<string, Promise<void>>();
  private events = new EventEmitter();
  private counter = 0;

  constructor(private studioDir: string) {
    this.events.setMaxListeners(100);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.created.localeCompare(a.created));
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Follows a job: its log so far, then each new line, then its end. Returns a function that stops following. */
  follow(id: string, onLine: (line: string) => void, onEnd: (job: Job) => void): () => void {
    const job = this.jobs.get(id);
    if (!job) throw new ReelError(2, `no job ${id}`);
    job.log.forEach(onLine);
    if (job.status === "ok" || job.status === "failed") {
      onEnd(job);
      return () => {};
    }
    const line = (jid: string, l: string) => jid === id && onLine(l);
    const end = (jid: string) => jid === id && onEnd(this.jobs.get(id)!);
    this.events.on("line", line);
    this.events.on("end", end);
    return () => {
      this.events.off("line", line);
      this.events.off("end", end);
    };
  }

  start(kind: JobKind, target: string, args: JobArgs = {}): Job {
    if (!JOB_KINDS.includes(kind)) throw new ReelError(2, `no job kind "${kind}" (one of ${JOB_KINDS.join(", ")})`);
    const [p, m] = target.split("/");
    if (!p || !m) throw new ReelError(2, `"${target}" is not a mission or take`);
    const id = `${Date.now().toString(36)}-${++this.counter}`;
    const job: Job = { id, kind, target, args, status: "queued", created: new Date().toISOString(), log: [] };
    this.jobs.set(id, job);
    const mission = `${p}/${m}`;
    const before = this.queues.get(mission) ?? Promise.resolve();
    const done = before.then(() => this.run(job));
    this.queues.set(mission, done);
    return job;
  }

  private write(job: Job, line: string) {
    job.log.push(line);
    try {
      mkdirSync(join(vaultDir(), "jobs"), { recursive: true });
      appendFileSync(join(vaultDir(), "jobs", `${job.id}.log`), `${line}\n`);
    } catch {}
    this.events.emit("line", job.id, line);
  }

  private async run(job: Job): Promise<void> {
    job.status = "running";
    job.started = new Date().toISOString();
    const log = (line: string) => this.write(job, line);
    log(`${job.kind} ${job.target}`);
    try {
      job.result = await this.execute(job, log);
      job.status = "ok";
      log("done");
    } catch (e) {
      job.status = "failed";
      job.error = (e as Error).message;
      job.code = e instanceof ReelError ? e.code : 1;
      log(`failed: ${job.error}`);
    } finally {
      job.ended = new Date().toISOString();
      this.events.emit("end", job.id);
    }
  }

  private async execute(job: Job, log: (l: string) => void): Promise<unknown> {
    const [p, m] = job.target.split("/");
    const project = await loadProject(await loadStudio(this.studioDir), p);
    const mission = await loadMission(project, m);
    const a = job.args;
    if (job.kind === "record" || job.kind === "dry") {
      const r = await recordMission({ project, mission, scenes: a.scenes, flagged: a.flagged, all: a.all, dry: job.kind === "dry", log });
      return { ...r, take: r.take?.n };
    }
    const ref = parseTakeRef(job.target);
    switch (job.kind) {
      case "check":
        return checkPrivacy(ref, project, mission, log);
      case "cut":
        return (await cutTake(ref, project, mission, log)).plan.total;
      case "voice":
        return (await voiceTake(ref, project, mission, { yes: a.yes, budget: a.budget, force: a.force, log })).spent;
      case "mix":
        return (await mixTake(ref, project, mission, log)).loudness;
      case "package":
        return packageTake(ref, project, mission, { allowMissing: a.allowMissing, log });
      case "make":
        return makeTake(ref, project, mission, { yes: a.yes, budget: a.budget, force: a.force, allowMissing: a.allowMissing, log });
    }
  }

  /** Resolves when every queued job has ended (for tests and shutdown). */
  async idle(): Promise<void> {
    await Promise.all(this.queues.values());
  }
}
