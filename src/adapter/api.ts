// The adapter plugin interface, published as "reel/adapter". Reel knows no application; an adapter (built outside
// Reel's repository) adds an application's own steps, masks and private strings. A step names whether it costs money
// or changes state, so a dry run can skip it.
import type { APIRequestContext, Page } from "playwright";
import type { z } from "zod";
import type { SecretStore } from "./secrets.js";

export type { SecretStore };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One thing that happened on screen, `t` seconds into the scene's video. The cue sheet for the edit. */
export interface TimelineEvent {
  t: number;
  kind: "say" | "unsay" | "card" | "uncard" | "spot" | "click" | "mark" | "wait";
  title: string;
  note?: string;
  spoken?: string;
  label?: string;
  box?: Box;
  end?: number;
  scene: string;
  /** The index of a `say` within its scene (the key of its translations and of its review frame). */
  n?: number;
}

export interface SayOptions {
  label?: string;
  spoken?: string;
  spot?: string;
  place?: "bottom" | "top";
  hold?: number;
  keep?: boolean;
  /** The caption's number in its scene (set by the step runner from the script). */
  n?: number;
}

/** What a step can do on screen: the stage of a scene (one per seat). */
export interface StageLike {
  readonly page: Page;
  readonly timeline: TimelineEvent[];
  now(): number;
  mark(title: string, note?: string): TimelineEvent;
  pause(seconds?: number): Promise<void>;
  say(text: string, opts?: SayOptions): Promise<void>;
  unsay(): Promise<void>;
  card(title: string, text?: string, opts?: { hold?: number }): Promise<void>;
  uncard(): Promise<void>;
  spot(target: string): Promise<void>;
  goto(path: string): Promise<void>;
  navigate(path: string): Promise<void>;
  hover(target: string, opts?: { rest?: number }): Promise<void>;
  click(target: string, opts?: { rest?: number; after?: number }): Promise<void>;
  type(target: string, text: string, opts?: { delay?: number }): Promise<void>;
  scroll(dy: number, target?: string, opts?: { duration?: number }): Promise<void>;
  zoom(target: string, notches: number, opts?: { gap?: number }): Promise<void>;
  waitFor(target: string, opts?: { state?: "visible" | "hidden" | "attached"; timeout?: number }): Promise<void>;
  /** A marked wait: a stretch the edit cuts or speeds up. */
  wait<T>(title: string, fn: () => Promise<T>): Promise<T>;
  css(content: string): Promise<void>;
  /** Glides to a select and picks an option, by its value or its label. */
  select(target: string, pick: { value?: string; label?: string }): Promise<void>;
  settled(target: string, opts?: { quiet?: number; timeout?: number }): Promise<void>;
}

export interface StateBag {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
}

export interface StepContext {
  stage: StageLike;
  seat(name: string): StageLike;
  state: StateBag;
  page: Page;
  /** Requests to the app's own API (its base URL), signed in as the recording is. */
  api: APIRequestContext;
  /** The adapter's secrets, kept in the vault (never in the studio). */
  secrets: SecretStore;
  /** project.yaml's adapter_options, checked by `Adapter.options`. */
  options: Record<string, unknown>;
  dry: boolean;
  scene: string;
  log(msg: string): void;
}

export interface StepDef<A = unknown> {
  args: z.ZodType<A> | null;
  /** Calls something that costs money (a DM turn, a paid picture). */
  costs?: boolean;
  /** Changes the application's state (makes a campaign, sends a turn). */
  changes?: boolean;
  run(ctx: StepContext, args: A): Promise<unknown>;
  /** What a dry run does instead (and returns) for a step that costs or changes. */
  dry?(ctx: StepContext, args: A): Promise<unknown>;
}

export interface Adapter {
  name: string;
  version: string;
  steps: Record<string, StepDef<any>>;
  masks?: string[];
  privateStrings?: string[];
  /** The schema of project.yaml's adapter_options. */
  options?: z.ZodType<Record<string, unknown>>;
  /** Before each scene's first step, on every seat's page (host included). */
  init?(ctx: { page: Page; state: StateBag; seat: string }): Promise<void>;
}

export function defineAdapter(adapter: Adapter): Adapter {
  return adapter;
}
