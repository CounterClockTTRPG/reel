// The join: a take's scenes cut by the plan into one video (no sound yet), with the opening, chapter, closing and
// credits cards rendered from the style's card templates, the style's transitions, a badge on sped-up waits, a fade
// out at the end, and chapter marks in the file. Writes cut.mp4, plan.json, markers.json, chapters.txt and
// chapters.vtt into the take.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { cardNamed, loadEffects, renderCard, transitionNamed } from "../library/effects.js";
import { loadMusic } from "../library/music.js";
import type { Mission, Project } from "../model/load.js";
import { effectiveStyle } from "../model/style.js";
import { attributionOf, chooseMusic, tracksUsed } from "../sound/choice.js";
import { readTake, takeSceneFiles, type TakeRef } from "../take/take.js";
import { requireTools, run } from "../util/proc.js";
import { planCut, type CutPlan } from "./cutplan.js";

const FPS = 30;

const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

export function chaptersVtt(plan: CutPlan): string {
  const cues = [...(plan.chapters[0]?.start > 0.5 ? [{ title: "Opening", start: 0, end: plan.chapters[0].start }] : []), ...plan.chapters];
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.title}\n`).join("\n")}`;
}

function ffmetadata(title: string, plan: CutPlan): string {
  const lines = [";FFMETADATA1", `title=${title.replace(/[=;#\\\n]/g, (c) => `\\${c}`)}`];
  for (const c of plan.chapters) {
    lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${c.title}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface CutResult {
  file: string;
  plan: CutPlan;
}

export async function cutTake(ref: TakeRef, project: Project, mission: Mission, log: (m: string) => void = () => {}): Promise<CutResult> {
  await requireTools("ffmpeg");
  const { style } = effectiveStyle(project, mission);
  const effects = await loadEffects(project.studio);
  const lib = await loadMusic(project.studio);
  const take = readTake(ref);
  const files = new Map(takeSceneFiles(take).map((s) => [s.id, s]));
  const music = await chooseMusic(ref, mission, style, lib);
  const credits = tracksUsed(music, lib).map(attributionOf);
  const sceneDefs = new Map(mission.chapters.flatMap((c) => c.file.scenes.map((s) => [s.id, s])));

  const plan = planCut({
    opening: mission.file.opening,
    closing: mission.file.closing ?? null,
    credits: credits.length ? { title: "Music", text: credits.join("\n"), hold: 7 } : null,
    cutWaits: mission.file.cut_waits,
    interstitials: mission.file.interstitials,
    transitions: {
      chapter: transitionNamed(effects, style.transitions.chapter),
      card: transitionNamed(effects, style.transitions.card),
      cut: transitionNamed(effects, style.transitions.cut),
    },
    chapters: mission.chapters.map((c) => ({
      key: c.key,
      title: c.file.title,
      text: c.file.text,
      scenes: c.file.scenes.filter((s) => files.has(s.id)).map((s) => {
        const f = files.get(s.id)!;
        return { id: s.id, video: f.video, duration: f.duration, events: f.events, ...(sceneDefs.get(s.id)?.speed ? { speed: sceneDefs.get(s.id)!.speed } : {}) };
      }),
    })),
  });

  // The cards, rendered once each.
  const cardsDir = join(ref.dir, "cards");
  mkdirSync(cardsDir, { recursive: true });
  const browser = await chromium.launch();
  const pictures = new Map<number, string>();
  try {
    for (const [i, s] of plan.segments.entries()) {
      if (s.kind !== "card") continue;
      const template = readFileSync(cardNamed(effects, style.cards[s.card!.template ?? "opening"]), "utf8");
      const file = join(cardsDir, `card-${i}.png`);
      await renderCard(template, { title: s.card!.title, text: s.card!.text, number: s.card!.number, small: s.card!.small }, style.size, file, browser);
      pictures.set(i, file);
    }
  } finally {
    await browser.close();
  }

  const { width: W, height: H } = style.size;
  const inputs: string[] = [];
  const filters: string[] = [];
  plan.segments.forEach((s, i) => {
    if (s.kind === "card") {
      inputs.push("-loop", "1", "-framerate", String(FPS), "-t", s.length.toFixed(3), "-i", pictures.get(i)!);
      filters.push(`[${i}:v]fps=${FPS},scale=${W}:${H},setsar=1,format=yuv420p,trim=duration=${s.length.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    } else {
      const speed = s.speed ?? 1;
      inputs.push("-ss", s.from.toFixed(3), "-t", (s.length * speed).toFixed(3), "-i", s.source!);
      const badge = s.badge
        ? `,drawtext=text='${s.badge}':x=w-tw-48:y=40:fontsize=${Math.round(H / 20)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=16`
        : "";
      filters.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speed},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p${badge},trim=duration=${s.length.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    }
  });
  let last = "v0";
  plan.segments.forEach((s, i) => {
    if (i === 0) return;
    const t = s.transition!;
    filters.push(`[${last}][v${i}]xfade=transition=${t.kind}:duration=${t.length.toFixed(3)}:offset=${s.start.toFixed(3)}[x${i}]`);
    last = `x${i}`;
  });
  filters.push(`[${last}]fade=t=out:st=${Math.max(0, plan.total - 1).toFixed(3)}:d=1[out]`);

  const raw = join(ref.dir, "cut-raw.mp4");
  const meta = join(ref.dir, "chapters.txt");
  writeFileSync(meta, ffmetadata(mission.file.title, plan));
  writeFileSync(join(ref.dir, "filter.txt"), filters.join(";\n"));
  log(`  joining ${plan.segments.length} segments into ${plan.total.toFixed(1)} s`);
  await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex_script", join(ref.dir, "filter.txt"),
    "-map", "[out]", "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), raw]);
  const file = join(ref.dir, "cut.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-i", meta, "-map_metadata", "1", "-map_chapters", "1", "-c", "copy",
    "-movflags", "+faststart", `${file}.tmp.mp4`]);
  renameSync(`${file}.tmp.mp4`, file);
  writeFileSync(join(ref.dir, "plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(ref.dir, "markers.json"), JSON.stringify({ total: plan.total, chapters: plan.chapters, markers: plan.markers }, null, 2));
  writeFileSync(join(ref.dir, "chapters.vtt"), chaptersVtt(plan));
  return { file, plan };
}
