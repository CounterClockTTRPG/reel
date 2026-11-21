// The mix: the score (each scene's track, starting where the music changes, crossfaded, looped when a stretch outlasts
// it), the narration, each normalised to its own loudness (so the music stays under the voice between lines too), the
// music ducked further while the narrator speaks, and a limiter on the peaks. Then the loudness check: measured, not
// judged by ear, it fails a mix whose music-only stretches come within `check_margin` dB of the speech.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CutPlan } from "../edit/cutplan.js";
import { loadMusic, trackPath } from "../library/music.js";
import type { Mission, Project } from "../model/load.js";
import type { Style } from "../model/schema.js";
import { effectiveStyle } from "../model/style.js";
import { ReelError } from "../paths.js";
import type { TakeRef } from "../take/take.js";
import { requireTools, run } from "../util/proc.js";
import { chooseMusic } from "./choice.js";
import { readPlan, type PlacedLine } from "./voice.js";

/** The crossfade between two of a score's tracks, seconds. */
export const CROSSFADE = 2.5;
/** Music-only stretches shorter than this are not measured. */
const MIN_STRETCH = 2;

export interface Cue {
  track: string;
  file: string;
  start: number;
  length: number;
}

/** Where each track starts: at the first segment whose scene plays another track than the one before. */
export function scoreCues(plan: CutPlan, music: Record<string, string>): { track: string; start: number }[] {
  const firstTrack = Object.values(music)[0];
  const cues: { track: string; start: number }[] = [];
  let current: string | undefined;
  for (const s of plan.segments) {
    const track = s.kind === "scene" ? music[s.scene!] : (current ?? firstTrack);
    if (!track || track === current) continue;
    cues.push({ track, start: cues.length ? s.start : 0 });
    current = track;
  }
  return cues;
}

async function stretchLufs(file: string, from: number, to: number): Promise<number> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-ss", from.toFixed(3), "-t", Math.max(0.4, to - from).toFixed(3),
    "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const m = summary.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/);
  if (!m) throw new ReelError(1, `ffmpeg ebur128 gave no loudness for ${file}`);
  return m[1] === "-inf" ? -70 : Math.max(-70, Number(m[1]));
}

/** The loudness (LUFS) of these stretches of a file together: each measured, averaged by energy and length. */
export async function measureLufs(file: string, stretches: [number, number][]): Promise<number> {
  let energy = 0;
  let length = 0;
  for (const [a, b] of stretches) {
    const l = await stretchLufs(file, a, b);
    energy += 10 ** (l / 10) * (b - a);
    length += b - a;
  }
  return length ? Math.round(10 * Math.log10(energy / length) * 10) / 10 : -70;
}

export interface LoudnessReport {
  ok: boolean;
  speechLufs: number;
  musicOnlyMaxLufs: number | null;
  margin: number | null;
  required: number;
  stretches: { from: number; to: number; lufs: number }[];
}

export async function loudnessCheck(file: string, lines: PlacedLine[], total: number, style: Style): Promise<LoudnessReport> {
  const speech: [number, number][] = lines.map((l) => [l.at, l.at + l.length]);
  const quiet: [number, number][] = [];
  let free = 0;
  for (const [a, b] of [...speech].sort((x, y) => x[0] - y[0])) {
    if (a - free >= MIN_STRETCH) quiet.push([free + 0.3, a - 0.3]);
    free = Math.max(free, b);
  }
  // The last seconds fade out; they aren't a music-only stretch to judge.
  if (total - 4 - free >= MIN_STRETCH) quiet.push([free + 0.3, total - 4]);
  const speechLufs = speech.length ? await measureLufs(file, speech) : -70;
  const stretches = [];
  for (const [from, to] of quiet) stretches.push({ from, to, lufs: await measureLufs(file, [[from, to]]) });
  const loudest = stretches.length ? Math.max(...stretches.map((s) => s.lufs)) : null;
  const margin = loudest === null ? null : Math.round((speechLufs - loudest) * 10) / 10;
  const required = style.loudness.check_margin;
  const failing = stretches.filter((s) => speechLufs - s.lufs < required);
  return { ok: failing.length === 0, speechLufs, musicOnlyMaxLufs: loudest, margin, required, stretches: failing };
}

export async function mixTake(ref: TakeRef, project: Project, mission: Mission, log: (m: string) => void = () => {}) {
  await requireTools("ffmpeg");
  const { style } = effectiveStyle(project, mission);
  const plan = readPlan(ref);
  const video = join(ref.dir, "cut.mp4");
  const linesFile = join(ref.dir, "voice", "lines.json");
  if (!existsSync(linesFile)) throw new ReelError(1, `take ${ref.project}/${ref.mission}/${ref.n} has no narration yet: run \`reel voice\` first`);
  const lines = (JSON.parse(readFileSync(linesFile, "utf8")) as { lines: PlacedLine[] }).lines;
  const lib = await loadMusic(project.studio);
  const music = await chooseMusic(ref, mission, style, lib);
  const starts = scoreCues(plan, music);
  const cues: Cue[] = starts.map((c, i) => {
    const track = lib.tracks.find((t) => t.id === c.track);
    if (!track) throw new ReelError(1, `the take plays track "${c.track}", which is no longer in library/music.yaml`);
    const file = trackPath(project.studio, track);
    if (!existsSync(file)) throw new ReelError(1, `music track missing from disk: ${file}`);
    const next = starts[i + 1];
    return { track: c.track, file, start: c.start, length: (next?.start ?? plan.total) - c.start + (next ? CROSSFADE : 0) };
  });
  log(`  score: ${cues.map((c) => `${c.track} at ${c.start.toFixed(1)} s`).join(", ") || "no music"}`);

  const T = plan.total.toFixed(3);
  const inputs = ["-i", video, "-i", join(ref.dir, "voice", "narration.wav"), ...cues.flatMap((c) => ["-stream_loop", "-1", "-i", c.file])];
  const filters = [`[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=${style.loudness.voice}:TP=-2:LRA=7,asplit=2[voice][key]`];
  if (cues.length) {
    cues.forEach((c, i) => {
      const fadeOut = cues[i + 1] ? CROSSFADE : 4;
      filters.push(`[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${c.length.toFixed(3)},` +
        `afade=t=in:d=${i ? CROSSFADE : 2},afade=t=out:st=${Math.max(0, c.length - fadeOut).toFixed(3)}:d=${fadeOut},` +
        `adelay=${Math.round(c.start * 1000)}:all=1,apad[m${i}]`);
    });
    filters.push(`${cues.map((_, i) => `[m${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,` +
      `atrim=0:${T},loudnorm=I=${style.music.loudness}:TP=-8:LRA=7[music]`);
    filters.push("[music][key]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=700[ducked]");
    filters.push("[voice][ducked]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]");
  } else {
    filters.push("[key]anullsink", "[voice]alimiter=limit=0.89[a]");
  }
  const script = join(ref.dir, "voice", "mix-filter.txt");
  writeFileSync(script, filters.join(";\n"));
  const file = join(ref.dir, "mix.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex_script", script, "-map", "0:v", "-map", "[a]",
    "-map_metadata", "0", "-map_chapters", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", T, "-movflags", "+faststart", file]);
  const loudness = await loudnessCheck(file, lines, plan.total, style);
  writeFileSync(join(ref.dir, "checks", "loudness.json"), JSON.stringify(loudness, null, 2));
  log(`  loudness: speech ${loudness.speechLufs} LUFS, music-only at most ${loudness.musicOnlyMaxLufs ?? "–"} LUFS (${loudness.ok ? "ok" : "too loud"})`);
  return { file, loudness, cues };
}
