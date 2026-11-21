// Running a scene's steps: core and adapter steps, `optional`, `if`, `parallel`, steps on another seat, `as` to keep a
// result, and dry runs that skip (or stub) what costs money or changes state.
import type { APIRequestContext } from "playwright";
import type { Adapter, SecretStore, StageLike, StateBag } from "../adapter/api.js";

const refuse = () => {
  throw new ReelError(1, "this run has no project to keep secrets for");
};
const noSecrets: SecretStore = { get: () => undefined, set: refuse, delete: refuse, clear: refuse };
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

/** Whether something matching `selector` is on the page and visible. */
async function visible(stage: StageLike, selector: string): Promise<boolean> {
  return stage.page.locator(selector).first().isVisible().catch(() => false);
}

/** A key `{{name}}` refers to that no earlier step kept. */
class MissingKey extends Error {}

/** The step with every `{{key}}` in its text replaced by what an earlier step kept under that key (`as: key`). */
export function fillState(step: Step, state: StateBag): Step {
  const fill = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
        if (!state.has(key) || state.get(key) === undefined || state.get(key) === null) throw new MissingKey(key);
        const v = state.get(key);
        return typeof v === "object" ? JSON.stringify(v) : String(v);
      });
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "parallel" ? v : fill(v)]));
    return value;
  };
  return fill(step) as Step;
}

export async function runSteps(steps: Step[], ctx: RunContext, prefix = ""): Promise<void> {
  for (const [i, written] of steps.entries()) {
    const where = `${prefix}step ${i + 1}`;
    let step: Step;
    try {
      step = typeof written === "string" || "parallel" in written ? written : fillState(written, ctx.state);
    } catch (e) {
      if (!(e instanceof MissingKey)) throw e;
      if (ctx.dry) {
        ctx.log(`  (dry: skipped ${describeStep(written)}: no "${e.message}" from a real run yet)`);
        continue;
      }
      throw new ReelError(1, `scene "${ctx.scene}", ${where} (${describeStep(written)}): {{${e.message}}}: no earlier step kept "${e.message}" (as: ${e.message})`, { scene: ctx.scene });
    }
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
    const n = ctx.says?.get(written);
    if (resolved.name === "say" && n !== undefined) {
      resolved.args = typeof resolved.args === "string" ? { text: resolved.args, n } : { ...(resolved.args as object), n };
    }
    const common = typeof step === "string" ? {} : step;
    const stage = common.seat ? ctx.seat(common.seat) : ctx.stage;
    if (common.if && !(await visible(stage, common.if))) {
      ctx.log(`  (skipped ${describeStep(step)}: nothing shows ${common.if})`);
      continue;
    }
    if (common.unless && (await visible(stage, common.unless))) {
      ctx.log(`  (skipped ${describeStep(step)}: ${common.unless} shows)`);
      continue;
    }
    const stepCtx = { stage, seat: ctx.seat, state: ctx.state, page: stage.page, api: ctx.api ?? stage.page.request,
      secrets: ctx.secrets ?? noSecrets, options: ctx.options ?? {}, seatName: common.seat ?? "host", dry: ctx.dry, scene: ctx.scene, log: ctx.log };
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
