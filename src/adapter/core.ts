// The core steps every film can use, whatever the application, and resolving a step (core or an adapter's) to what
// runs it.
import { stepAction } from "../model/load.js";
import { CORE_STEP_ARGS, type Step } from "../model/schema.js";
import { ReelError } from "../paths.js";
import type { Adapter, StepDef } from "./api.js";

type Args<K extends keyof typeof CORE_STEP_ARGS> = import("zod").infer<(typeof CORE_STEP_ARGS)[K]>;
const targetOf = (a: string | { target: string }) => (typeof a === "string" ? a : a.target);

export const CORE_STEPS: Record<string, StepDef<any>> = {
  goto: { args: CORE_STEP_ARGS.goto, run: (c, a: string) => c.stage.goto(a) },
  navigate: { args: CORE_STEP_ARGS.navigate, run: (c, a: string) => c.stage.navigate(a) },
  click: {
    args: CORE_STEP_ARGS.click,
    run: (c, a: Args<"click">) => c.stage.click(targetOf(a), typeof a === "string" ? {} : { rest: a.rest, after: a.after }),
  },
  hover: { args: CORE_STEP_ARGS.hover, run: (c, a: Args<"hover">) => c.stage.hover(targetOf(a)) },
  type: { args: CORE_STEP_ARGS.type, run: (c, a: Args<"type">) => c.stage.type(a.target, a.text, { delay: a.delay }) },
  scroll: {
    args: CORE_STEP_ARGS.scroll,
    run: (c, a: Args<"scroll">) =>
      typeof a === "number" ? c.stage.scroll(a) : c.stage.scroll(a.dy, a.target, { duration: a.duration }),
  },
  zoom: { args: CORE_STEP_ARGS.zoom, run: (c, a: Args<"zoom">) => c.stage.zoom(a.target, a.notches) },
  say: {
    args: CORE_STEP_ARGS.say,
    run: (c, a: Args<"say">) => {
      if (typeof a === "string") return c.stage.say(a);
      const { text, ...opts } = a;
      return c.stage.say(text, opts);
    },
  },
  unsay: { args: CORE_STEP_ARGS.unsay, run: (c) => c.stage.unsay() },
  card: { args: CORE_STEP_ARGS.card, run: (c, a: Args<"card">) => c.stage.card(a.title, a.text, { hold: a.hold }) },
  uncard: { args: CORE_STEP_ARGS.uncard, run: (c) => c.stage.uncard() },
  spot: { args: CORE_STEP_ARGS.spot, run: (c, a: string) => c.stage.spot(a) },
  "wait-for": {
    args: CORE_STEP_ARGS["wait-for"],
    run: (c, a: Args<"wait-for">) =>
      typeof a === "string" ? c.stage.waitFor(a) : c.stage.waitFor(a.target, { state: a.state, timeout: a.timeout }),
  },
  pause: { args: CORE_STEP_ARGS.pause, run: (c, a: number) => c.stage.pause(a) },
  mark: {
    args: CORE_STEP_ARGS.mark,
    run: async (c, a: Args<"mark">) => {
      if (typeof a === "string") c.stage.mark(a);
      else c.stage.mark(a.title, a.note);
    },
  },
  wait: {
    args: CORE_STEP_ARGS.wait,
    run: (c, a: Args<"wait">) =>
      c.stage.wait(a.title, () => c.page.locator(a.until).first().waitFor({ state: a.state ?? "visible", timeout: (a.timeout ?? 300) * 1000 })),
  },
  css: { args: CORE_STEP_ARGS.css, run: (c, a: string) => c.stage.css(a) },
  select: {
    args: CORE_STEP_ARGS.select,
    run: (c, a: Args<"select">) => c.stage.select(a.target, { value: a.value, label: a.label }),
  },
};

export interface ResolvedStep {
  name: string;
  def: StepDef<any>;
  args: unknown;
}

/** The definition and checked arguments of a step; `parallel` is handled by the step runner. */
export function resolveStep(step: Step, adapter: Adapter | null): ResolvedStep {
  const { name, args } = stepAction(step);
  if (!name.includes(".")) {
    const def = CORE_STEPS[name];
    if (!def) throw new ReelError(1, `unknown step "${name}"`);
    const parsed = def.args ? def.args.safeParse(args) : { success: true as const, data: args };
    if (!parsed.success) throw new ReelError(1, `step "${name}": ${parsed.error.issues[0].message}`);
    return { name, def, args: parsed.data };
  }
  const [prefix, ...rest] = name.split(".");
  if (!adapter) throw new ReelError(1, `step "${name}": the project has no adapter (project.yaml adapter)`);
  if (prefix !== adapter.name) throw new ReelError(1, `step "${name}": the project's adapter is "${adapter.name}"`);
  const def = adapter.steps[rest.join(".")];
  if (!def) throw new ReelError(1, `step "${name}": adapter ${adapter.name} has no step "${rest.join(".")}"`);
  const parsed = def.args ? def.args.safeParse(args) : { success: true as const, data: args };
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ReelError(1, `step "${name}": ${issue.path.join(".") || "args"}: ${issue.message}`);
  }
  return { name, def, args: parsed.data };
}
