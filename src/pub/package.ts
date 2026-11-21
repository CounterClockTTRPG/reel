// The YouTube package of a mixed take, ready to upload as is: the video, an .srt per language (the narration's own
// words, and the translations), the chapter timestamps for the description box, a description draft with the music's
// credits, and a thumbnail (the opening card, or a chosen frame).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardNamed, loadEffects, renderCard } from "../library/effects.js";
import { loadMusic } from "../library/music.js";
import { translationStatus } from "../i18n/translations.js";
import type { Mission, Project } from "../model/load.js";
import { effectiveStyle } from "../model/style.js";
import { ReelError } from "../paths.js";
import { attributionOf, chooseMusic, tracksUsed } from "../sound/choice.js";
import { readPlan, type PlacedLine } from "../sound/voice.js";
import type { TakeRef } from "../take/take.js";
import { run } from "../util/proc.js";

const srtTime = (s: number) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23).replace(".", ",");

export function srt(cues: { at: number; length: number; text: string }[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.at)} --> ${srtTime(c.at + Math.max(1, c.length))}\n${c.text}\n`).join("\n");
}

/** YouTube's chapter format: m:ss (h:mm:ss past an hour), the first at 0:00. */
export function youtubeTime(s: number): string {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function youtubeChapters(chapters: { title: string; start: number }[]): string[] {
  const list = chapters[0] && chapters[0].start < 1 ? chapters : [{ title: "Opening", start: 0 }, ...chapters];
  return list.map((c, i) => `${youtubeTime(i === 0 ? 0 : c.start)} ${c.title}`);
}

export interface PackageOptions {
  allowMissing?: boolean;
  /** A frame of the video (seconds) for the thumbnail, instead of the opening card. */
  frame?: number;
  log?: (m: string) => void;
}

export async function packageTake(ref: TakeRef, project: Project, mission: Mission, opts: PackageOptions = {}): Promise<{ dir: string; warnings: string[] }> {
  const { style } = effectiveStyle(project, mission);
  const mix = join(ref.dir, "mix.mp4");
  if (!existsSync(mix)) throw new ReelError(1, `take ${ref.project}/${ref.mission}/${ref.n} isn't mixed yet: run \`reel mix\` first`);
  const plan = readPlan(ref);
  const lines = (JSON.parse(readFileSync(join(ref.dir, "voice", "lines.json"), "utf8")) as { lines: PlacedLine[] }).lines;
  const [narration, ...others] = style.languages;

  const problems: string[] = [];
  const subtitles: Record<string, string> = { [narration]: srt(lines) };
  for (const lang of others) {
    const status = translationStatus(mission, lang);
    const bad = [...status.missing, ...status.stale];
    if (bad.length) problems.push(`${lang}: ${status.missing.length ? `missing ${status.missing.join(", ")}` : ""}${status.missing.length && status.stale.length ? "; " : ""}${status.stale.length ? `stale ${status.stale.join(", ")}` : ""}`);
    subtitles[lang] = srt(lines.filter((l) => status.ok[l.key]).map((l) => ({ ...l, text: status.ok[l.key] })));
  }
  if (problems.length && !opts.allowMissing) {
    throw new ReelError(3, `translations not ready (pass --allow-missing to package without them): ${problems.join(" | ")}`, { problems });
  }

  const dir = join(ref.dir, "package");
  mkdirSync(dir, { recursive: true });
  copyFileSync(mix, join(dir, "video.mp4"));
  for (const [lang, text] of Object.entries(subtitles)) writeFileSync(join(dir, `${lang}.srt`), text);
  const chapters = youtubeChapters(plan.chapters);
  writeFileSync(join(dir, "chapters.txt"), `${chapters.join("\n")}\n`);
  if (existsSync(join(ref.dir, "chapters.vtt"))) copyFileSync(join(ref.dir, "chapters.vtt"), join(dir, "chapters.vtt"));

  const lib = await loadMusic(project.studio);
  const credits = tracksUsed(await chooseMusic(ref, mission, style, lib), lib).map(attributionOf);
  const description = [
    `# ${mission.file.title}`,
    "",
    mission.file.description ?? mission.file.opening.text ?? "",
    "",
    "## Chapters",
    "",
    ...chapters,
    ...(credits.length ? ["", "## Music", "", ...credits] : []),
    "",
  ].join("\n");
  writeFileSync(join(dir, "description.md"), description);

  const thumb = join(dir, "thumbnail.png");
  if (opts.frame !== undefined) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(opts.frame), "-i", mix, "-frames:v", "1", "-vf", "scale=1280:720", thumb]);
  } else {
    const effects = await loadEffects(project.studio);
    const template = readFileSync(cardNamed(effects, style.cards.opening), "utf8");
    // Drawn at the film's size and scaled down, so the card looks as it does in the film.
    const big = join(dir, "thumbnail-full.png");
    await renderCard(template, { title: mission.file.opening.title, text: mission.file.opening.text }, style.size, big);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", big, "-vf", "scale=1280:720", thumb]);
  }
  const warnings = problems.map((p) => `subtitles incomplete: ${p}`);
  if (plan.chapters.length < 3) warnings.push("YouTube shows chapters only for 3 or more (each at least 10 s)");
  for (const w of warnings) opts.log?.(`  ${w}`);
  return { dir, warnings };
}
