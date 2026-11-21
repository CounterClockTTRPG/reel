// The narration of a take: a line for every caption (its `spoken` line where it has one) and for the opening, closing
// and chapter cards, each spoken where it comes up on the film's clock, or after the line before it ends. The cost is
// estimated first; nothing is bought without --yes (or within --budget).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAdapter } from "../adapter/load.js";
import type { CutPlan, FilmMarker } from "../edit/cutplan.js";
import { voiceNamed } from "../library/voices.js";
import type { Mission, Project } from "../model/load.js";
import type { VoiceDef } from "../model/schema.js";
import { effectiveStyle } from "../model/style.js";
import { ReelError } from "../paths.js";
import { voiceGate } from "../pipeline/gates.js";
import type { TakeRef } from "../take/take.js";
import { probeDuration, run } from "../util/proc.js";
import { cacheFile, priceOf, providerFor, speakCached, type TtsProvider } from "./tts.js";

/** The least gap between two spoken lines, seconds. */
export const GAP = 0.3;

export interface Line {
  t: number;
  text: string;
  /** What the line is: `<scene>/<n>`, `opening`, `closing`, `<chapter>/chapter`. */
  key: string;
  length?: number;
}

export interface PlacedLine extends Line {
  at: number;
  length: number;
  file?: string;
}

function cardLine(m: FilmMarker): string {
  if (m.spoken) return m.spoken;
  const title = m.title.replace(/^Chapter \d+: /, "");
  return `${/[.?!]$/.test(title) ? title : `${title}.`} ${m.note ?? ""}`.trim();
}

/** What the narrator says, in order: the captions and the cards, not the credits or the edit's own cues. */
export function voiceLines(plan: CutPlan): Line[] {
  return plan.markers.flatMap((m): Line[] => {
    if (m.kind === "say" && m.note) return [{ t: m.t, text: m.spoken ?? m.note, key: `${m.scene}/${m.n}` }];
    if (m.kind === "card" && m.scene !== "credits") return [{ t: m.t, text: cardLine(m), key: m.scene }];
    return [];
  });
}

/** Each line at its time, or after the line before it ends (and a gap). */
export function placeLines(lines: (Line & { length: number })[]): PlacedLine[] {
  let free = 0;
  return [...lines].sort((a, b) => a.t - b.t).map((line) => {
    const at = Math.max(line.t, free);
    free = at + line.length + GAP;
    return { ...line, at: Math.round(at * 1000) / 1000 };
  });
}

export interface Estimate {
  lines: number;
  cached: number;
  toBuy: number;
  characters: number;
  usd: number;
}

export function estimate(lines: Line[], voice: VoiceDef, isCached: (text: string) => boolean): Estimate {
  const buy = [...new Set(lines.map((l) => l.text))].filter((t) => !isCached(t));
  const characters = buy.reduce((n, t) => n + t.length, 0);
  return { lines: lines.length, cached: lines.length - lines.filter((l) => buy.includes(l.text)).length, toBuy: buy.length, characters, usd: priceOf(voice, characters) };
}

export function readPlan(ref: TakeRef): CutPlan {
  const file = join(ref.dir, "plan.json");
  if (!existsSync(file)) throw new ReelError(1, `take ${ref.project}/${ref.mission}/${ref.n} isn't cut yet: run \`reel cut\` first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export interface VoiceOptions {
  yes?: boolean;
  budget?: number;
  force?: boolean;
  provider?: TtsProvider;
  concurrency?: number;
  log?: (m: string) => void;
}

/** What voicing a take would cost now, without spending. */
export async function voiceEstimate(ref: TakeRef, project: Project, mission: Mission, provider?: TtsProvider): Promise<Estimate & { voice: string }> {
  const { style } = effectiveStyle(project, mission);
  const voice = await voiceNamed(project.studio, style.voice);
  const p = provider ?? providerFor(voice);
  const lines = voiceLines(readPlan(ref));
  return { ...estimate(lines, voice, (t) => existsSync(cacheFile(voice, t, p.id))), voice: style.voice };
}

export async function voiceTake(ref: TakeRef, project: Project, mission: Mission, opts: VoiceOptions = {}) {
  const log = opts.log ?? (() => {});
  const adapter = await loadAdapter(project.file.adapter, project.dir);
  voiceGate(ref, mission, adapter?.version ?? "", { force: opts.force });
  const { style } = effectiveStyle(project, mission);
  const voice = await voiceNamed(project.studio, style.voice);
  const provider = opts.provider ?? providerFor(voice);
  const plan = readPlan(ref);
  const lines = voiceLines(plan);
  const est = estimate(lines, voice, (t) => existsSync(cacheFile(voice, t, provider.id)));
  log(`Narration: ${est.lines} lines, ${est.cached} cached, ${est.toBuy} to buy (${est.characters} characters, $${est.usd.toFixed(4)})`);
  if (est.toBuy && !opts.yes && !(opts.budget !== undefined && est.usd <= opts.budget)) {
    throw new ReelError(4, `voicing would spend $${est.usd.toFixed(4)} on ${est.toBuy} lines (${est.characters} characters): pass --yes, or --budget <usd>`, { estimate: est });
  }

  const who = { project: ref.project, mission: ref.mission, take: ref.n };
  const files = new Map<string, string>();
  const texts = [...new Set(lines.map((l) => l.text))];
  let next = 0;
  let failure: unknown = null;
  let spent = 0;
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, async () => {
    while (next < texts.length && !failure) {
      const text = texts[next++];
      try {
        const { file, bought } = await speakCached(text, voice, provider, who);
        if (bought) {
          spent += priceOf(voice, text.length);
          log(`  spoken: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
        }
        files.set(text, file);
      } catch (e) {
        failure ??= e;
      }
    }
  }));
  if (failure) {
    const message = (failure as Error).message;
    throw new ReelError(1, message.includes("\"") ? message : `TTS failed: ${message}`, { spent });
  }

  const measured = await Promise.all(lines.map(async (l) => ({ ...l, file: files.get(l.text)!, length: await probeDuration(files.get(l.text)!) })));
  const placed = placeLines(measured).map((l) => ({ ...l, file: measured.find((m) => m.key === l.key)!.file }));
  for (const l of placed) if (l.at - l.t > 2) log(`  "${l.text.slice(0, 50)}…" waits ${(l.at - l.t).toFixed(1)} s for the line before`);
  const end = placed.at(-1) ? placed.at(-1)!.at + placed.at(-1)!.length : 0;
  if (end > plan.total) log(`  the last line ends ${(end - plan.total).toFixed(1)} s after the video`);

  const dir = join(ref.dir, "voice");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "narration.wav");
  const inputs = placed.flatMap((l) => ["-i", l.file!]);
  const filters = placed.map((l, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(l.at * 1000)}:all=1[l${i}]`);
  filters.push(`${placed.map((_, i) => `[l${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad,atrim=0:${plan.total.toFixed(3)}[a]`);
  writeFileSync(join(dir, "filter.txt"), filters.join(";\n"));
  await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex_script", join(dir, "filter.txt"), "-map", "[a]", file]);
  writeFileSync(join(dir, "lines.json"), JSON.stringify({ voice: style.voice, lines: placed }, null, 2));
  return { file, lines: placed, spent, estimate: est };
}
