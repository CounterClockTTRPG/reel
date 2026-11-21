// The stage of one scene (one per seat), ported from delve-video: a cursor that glides on an eased, slightly curved
// path, clicks that ripple, captions held as long as they take to read, title cards, a spotlight, typing at a human
// pace, smooth scrolls. Everything it shows is also an event on the timeline, the cue sheet for the edit.
import type { Page } from "playwright";
import type { Box, SayOptions, StageLike, TimelineEvent } from "../adapter/api.js";

/** Reading pace for captions: words per second, for people meeting the application for the first time. */
export const WORDS_PER_SECOND = 2.6;

/** How long a viewer needs to read `text`. */
export function readingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(3.5, 1.5 + words / WORDS_PER_SECOND);
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface StageOptions {
  startedAt: number;
  scene: string;
  who?: string;
  log?: (msg: string) => void;
}

export class Stage implements StageLike {
  readonly timeline: TimelineEvent[] = [];
  private mouse: { x: number; y: number };
  private says = 0;
  scene: string;

  constructor(
    readonly page: Page,
    private opts: StageOptions,
  ) {
    this.scene = opts.scene;
    const size = page.viewportSize() ?? { width: 1920, height: 1080 };
    this.mouse = { x: size.width / 2, y: size.height / 2 };
  }

  /** Seconds since the scene's video started. */
  now(): number {
    return Math.round((Date.now() - this.opts.startedAt) / 100) / 10;
  }

  private event(e: Omit<TimelineEvent, "t" | "scene">): TimelineEvent {
    const event = { t: this.now(), scene: this.scene, ...e } as TimelineEvent;
    this.timeline.push(event);
    this.opts.log?.(`  [${event.t.toFixed(1)}s]${this.opts.who ? ` (${this.opts.who})` : ""} ${event.kind}: ${event.title}`);
    return event;
  }

  mark(title: string, note = ""): TimelineEvent {
    return this.event({ kind: "mark", title, ...(note ? { note } : {}) });
  }

  async pause(seconds = 1.5): Promise<void> {
    await this.page.waitForTimeout(seconds * 1000);
  }

  private loc(target: string) {
    return this.page.locator(target).first();
  }

  private async box(target: string): Promise<Box | undefined> {
    const box = await this.loc(target).boundingBox();
    return box ?? undefined;
  }

  async card(title: string, text = "", { hold }: { hold?: number } = {}): Promise<void> {
    this.event({ kind: "card", title, ...(text ? { note: text } : {}) });
    await this.page.evaluate(([t, x]) => (window as any).__stage.card(t, x), [title, text]);
    await this.pause(0.7 + (hold ?? readingTime(`${title} ${text}`)));
  }

  async uncard(): Promise<void> {
    this.event({ kind: "uncard", title: "" });
    await this.page.evaluate(() => (window as any).__stage.uncard());
    await this.pause(0.8);
  }

  async say(text: string, { label = "", spoken, spot, place = "bottom", hold, keep = false }: SayOptions = {}): Promise<void> {
    let box: Box | undefined;
    if (spot) box = await this.light(spot);
    this.event({
      kind: "say",
      title: label || text.slice(0, 40),
      note: text,
      n: this.says++,
      ...(label ? { label } : {}),
      ...(spoken ? { spoken } : {}),
      ...(box ? { box } : {}),
    });
    await this.page.evaluate(([l, t, p]) => (window as any).__stage.caption(l, t, p), [label, text, place]);
    if (keep) return;
    await this.pause(0.5 + (hold ?? readingTime(text)));
    await this.unsay();
  }

  async unsay(): Promise<void> {
    this.event({ kind: "unsay", title: "" });
    await this.page.evaluate(() => {
      (window as any).__stage.uncaption();
      (window as any).__stage.unspot();
    });
    await this.pause(0.6);
  }

  /** Lights `target` and dims the rest of the page; nothing is lit when it isn't on the page. */
  async spot(target: string): Promise<void> {
    const box = await this.light(target);
    this.event({ kind: "spot", title: target, ...(box ? { box } : {}) });
  }

  private async light(target: string): Promise<Box | undefined> {
    const locator = this.loc(target);
    if (!(await locator.waitFor({ timeout: 5000 }).then(() => true, () => false))) {
      this.opts.log?.(`  (nothing to light: ${target})`);
      return undefined;
    }
    await locator.scrollIntoViewIfNeeded();
    await this.pause(0.3);
    const box = await this.box(target);
    if (box) await this.page.evaluate((b) => (window as any).__stage.spot(b), box);
    await this.pause(0.6);
    return box;
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await this.page.mouse.move(this.mouse.x, this.mouse.y);
    await this.pause(0.8);
  }

  /** Goes to `path` inside the app without reloading the page, so a title card stays up while it draws beneath. */
  async navigate(path: string): Promise<void> {
    await this.page.evaluate((p) => {
      history.pushState({}, "", p);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    const target = new URL(path, "http://x");
    await this.page.waitForURL((url) => url.pathname === target.pathname);
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await this.pause(0.8);
  }

  /** Glides the cursor to (x, y): eased in and out, on a gentle curve, slower over long distances. */
  async glide(x: number, y: number): Promise<void> {
    const from = { ...this.mouse };
    const dx = x - from.x;
    const dy = y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) return;
    const duration = Math.min(1600, Math.max(650, distance * 1.1));
    const bend = Math.min(80, distance * 0.12);
    const cx = from.x + dx / 2 - (dy / distance) * bend;
    const cy = from.y + dy / 2 + (dx / distance) * bend;
    const start = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = ease(t);
      const px = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * cx + e ** 2 * x;
      const py = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * cy + e ** 2 * y;
      await this.page.mouse.move(px, py);
      if (t === 1) break;
      await this.page.waitForTimeout(12);
    }
    this.mouse = { x, y };
  }

  async hover(target: string, { rest = 0.6 }: { rest?: number } = {}): Promise<void> {
    await this.loc(target).scrollIntoViewIfNeeded();
    const box = await this.box(target);
    if (!box) throw new Error(`Not on screen: ${target}`);
    await this.glide(box.x + box.width / 2, box.y + box.height / 2);
    await this.pause(rest);
  }

  /** Glides over, rests so the viewer sees what is about to be clicked, and clicks. */
  async click(target: string, { rest = 0.7, after = 1 }: { rest?: number; after?: number } = {}): Promise<void> {
    await this.hover(target, { rest });
    const box = await this.box(target);
    this.event({ kind: "click", title: target, ...(box ? { box } : {}) });
    await this.page.mouse.down();
    await this.pause(0.12);
    await this.page.mouse.up();
    await this.pause(after);
  }

  /** Clicks into a field and types at a pace a viewer can follow. */
  async type(target: string, text: string, { delay = 70 }: { delay?: number } = {}): Promise<void> {
    await this.click(target, { after: 0.4 });
    await this.loc(target).pressSequentially(text, { delay });
    await this.pause(1);
  }

  /** Scrolls the page (or the element under `target`) smoothly by `dy` pixels, eased. */
  async scroll(dy: number, target?: string, { duration = 1.6 }: { duration?: number } = {}): Promise<void> {
    if (target) await this.hover(target, { rest: 0.2 });
    const frames = Math.round(duration * 50);
    let done = 0;
    for (let i = 1; i <= frames; i++) {
      const next = dy * ease(i / frames);
      await this.page.mouse.wheel(0, next - done);
      done = next;
      await this.page.waitForTimeout(20);
    }
    await this.pause(0.6);
  }

  /** Zooms in (negative `notches` zoom out) around `target`'s centre, one wheel notch at a time. */
  async zoom(target: string, notches: number, { gap = 0.45 }: { gap?: number } = {}): Promise<void> {
    await this.hover(target, { rest: 0.4 });
    for (let i = 0; i < Math.abs(notches); i++) {
      await this.page.mouse.wheel(0, notches > 0 ? -120 : 120);
      await this.pause(gap);
    }
    await this.pause(0.8);
  }

  async waitFor(target: string, { state = "visible", timeout }: { state?: "visible" | "hidden" | "attached"; timeout?: number } = {}): Promise<void> {
    await this.loc(target).waitFor({ state, ...(timeout ? { timeout: timeout * 1000 } : {}) });
  }

  async wait<T>(title: string, fn: () => Promise<T>): Promise<T> {
    const event = this.event({ kind: "wait", title });
    try {
      return await fn();
    } finally {
      event.end = this.now();
    }
  }

  async css(content: string): Promise<void> {
    await this.page.addStyleTag({ content });
  }

  /** Waits until `target`'s text has stopped changing for `quiet` seconds (a streamed answer is finished). */
  async settled(target: string, { quiet = 3, timeout = 5 * 60 }: { quiet?: number; timeout?: number } = {}): Promise<void> {
    const end = Date.now() + timeout * 1000;
    let last = "";
    let since = Date.now();
    while (Date.now() < end) {
      const text = await this.loc(target).innerText().catch(() => "");
      if (text !== last) {
        last = text;
        since = Date.now();
      } else if (Date.now() - since >= quiet * 1000) return;
      await this.page.waitForTimeout(500);
    }
  }
}
