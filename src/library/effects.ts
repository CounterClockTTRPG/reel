// The effects library: named transitions (library/effects/transitions.yaml), card templates (cards/<name>.html) and
// overlay themes (overlays/<name>.css). Cards are rendered to pictures in a browser page.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { parseFile, type Studio } from "../model/load.js";
import { Transitions, type Transition } from "../model/schema.js";
import { ReelError } from "../paths.js";

export interface Effects {
  transitions: Record<string, Transition>;
  cards: Record<string, string>;
  overlays: Record<string, string>;
}

async function named(dir: string, ext: string): Promise<Record<string, string>> {
  if (!existsSync(dir)) return {};
  const files = (await readdir(dir)).filter((f) => f.endsWith(ext)).sort();
  return Object.fromEntries(files.map((f) => [f.slice(0, -ext.length), join(dir, f)]));
}

export async function loadEffects(studio: Studio): Promise<Effects> {
  const base = join(studio.dir, "library", "effects");
  const tfile = join(base, "transitions.yaml");
  const transitions = existsSync(tfile) ? (await parseFile(Transitions, tfile, studio.dir)).value.transitions : {};
  return { transitions, cards: await named(join(base, "cards"), ".html"), overlays: await named(join(base, "overlays"), ".css") };
}

export function transitionNamed(fx: Effects, name: string): Transition {
  const t = fx.transitions[name];
  if (!t) throw new ReelError(1, `no transition "${name}" in library/effects/transitions.yaml`);
  return t;
}

export function cardNamed(fx: Effects, name: string): string {
  const c = fx.cards[name];
  if (!c) throw new ReelError(1, `no card template "${name}" in library/effects/cards/`);
  return c;
}

const escape = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Fills a template: `{{name}}` (escaped), `{{#name}}…{{/name}}` (kept when the slot is set) and `{{^name}}…{{/name}}`
 * (kept when it isn't).
 */
export function fillTemplate(template: string, slots: Record<string, string | number | boolean | undefined>): string {
  let out = template;
  for (let guard = 0; guard < 20; guard++) {
    const next = out.replace(/\{\{([#^])(\w+)\}\}((?:(?!\{\{[#^]\2\}\})[\s\S])*?)\{\{\/\2\}\}/g, (_, kind, name, body) => {
      const on = Boolean(slots[name]);
      return (kind === "#") === on ? body : "";
    });
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{(\w+)\}\}/g, (_, name) => (slots[name] === undefined || slots[name] === false ? "" : escape(String(slots[name]))));
}

export interface CardSlots {
  title: string;
  text?: string;
  number?: string;
  small?: boolean;
}

/** Renders a card template to a PNG at `size`; returns the filled HTML. Pass `browser` to reuse one. */
export async function renderCard(
  template: string,
  slots: CardSlots,
  size: { width: number; height: number },
  outPng: string,
  browser?: Browser,
): Promise<string> {
  const html = fillTemplate(template, { ...slots, width: size.width, height: size.height });
  const own = browser ? null : await chromium.launch();
  try {
    const page = await (browser ?? own!).newPage({ viewport: size });
    await page.setContent(html);
    await page.screenshot({ path: outPng });
    await page.close();
  } finally {
    await own?.close();
  }
  return html;
}
