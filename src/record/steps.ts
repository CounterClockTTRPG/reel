// Running a scene's steps: core and adapter steps, `optional`, `if`, `parallel`, steps on another seat, `as` to keep a
// result, and dry runs that skip (or stub) what costs money or changes state.
import type { APIRequestContext } from "playwright";
import type { Adapter, SecretStore, StageLike, StateBag } from "../adapter/api.js";
import { secretsFor } from "../adapter/secrets.js";
import { resolveStep } from "../adapter/core.js";
import { stepAction } from "../model/load.js";
import type { Step } from "../model/schema.js";
import { ReelError } from "../paths.js";

export interface RunContext {
  stage: StageLike;
  seat(name: string): StageLike;
  state: StateBag;
  adapter: Adapter | null;
  api?: APIRequestContext;
  secrets?: SecretStore;
  options?: Record<string, unknown>;
  dry: boolean;
  scene: string;
  log(msg: string): void;
  /** The number of each say step of the scene (from `sayIndexes`), so caption keys follow the script. */
  says?: Map<Step, number>;
}

/** A short description of a step for messages: `click "#go"`. */
export function describeStep(step: Step): string {
  const { name, args } = stepAction(step);
  if (args === null) return name;
  const shown = typeof args === "string" || typeof args === "number" ? JSON.stringify(args) : JSON.stringify(args).slice(0, 60);
  return `${name} ${shown}`;
}

const isMissing = (e: unknown) =>
  e instanceof Error && (e.name === "TimeoutError" || /Timeout|Not on screen|waiting for/.test(e.message));

/** The seats a list of steps uses, so they can be opened before the scene starts. */
export function seatsIn(steps: Step[]): string[] {
  const seats = new Set<string>();
  for (const step of steps) {
    if (typeof step === "string") continue;
    if (step.seat) seats.add(step.seat);
    if (Array.isArray(step.parallel)) for (const list of step.parallel as Step[][]) for (const s of seatsIn(list)) seats.add(s);
  }
  return [...seats];
}

export async function runSteps(steps: Step[], ctx: RunContext, prefix = ""): Promise<void> {
  for (const [i, step] of steps.entries()) {
    const where = `${prefix}step ${i + 1}`;
    if (typeof step !== "string" && "parallel" in step) {
      const lists = step.parallel as Step[][];
      await Promise.all(lists.map((list, j) => runSteps(list, ctx, `${where}, branch ${j + 1}, `)));
      continue;
    }
    let resolved;
    try {
      resolved = resolveStep(step, ctx.adapter);
    } catch (e) {
      throw new ReelError(1, `scene "${ctx.scene}", ${where}: ${(e as Error).message}`, { scene: ctx.scene });
    }
    const n = ctx.says?.get(step);
    if (resolved.name === "say" && n !== undefined) {
      resolved.args = typeof resolved.args === "string" ? { text: resolved.args, n } : { ...(resolved.args as object), n };
    }
    const common = typeof step === "string" ? {} : step;
    const stage = common.seat ? ctx.seat(common.seat) : ctx.stage;
    if (common.if && (await stage.page.locator(common.if).count()) === 0) {
      ctx.log(`  (skipped ${describeStep(step)}: nothing matches ${common.if})`);
      continue;
    }
    const stepCtx = { stage, seat: ctx.seat, state: ctx.state, page: stage.page, api: ctx.api ?? stage.page.request,
      secrets: ctx.secrets ?? secretsFor("(none)"), options: ctx.options ?? {}, dry: ctx.dry, scene: ctx.scene, log: ctx.log };
    let result: unknown;
    try {
      if (ctx.dry && (resolved.def.costs || resolved.def.changes)) {
        if (resolved.def.dry) result = await resolved.def.dry(stepCtx, resolved.args);
        else {
          ctx.log(`  (dry: skipped ${describeStep(step)})`);
          result = common.as ? ctx.state.get(common.as) : undefined;
        }
      } else {
        result = await resolved.def.run(stepCtx, resolved.args);
      }
    } catch (e) {
      if (common.optional && isMissing(e)) {
        ctx.log(`  (optional, skipped: ${describeStep(step)})`);
        continue;
      }
      const message = (e as Error).message.split("\n")[0];
      throw new ReelError(1, `scene "${ctx.scene}", ${where} (${describeStep(step)}): ${message}`, { scene: ctx.scene, step: i });
    }
    if (common.as && result !== undefined) ctx.state.set(common.as, result);
  }
}
