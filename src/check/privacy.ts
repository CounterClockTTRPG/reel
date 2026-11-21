// The privacy frame check: frames of every scene (one a second, and one per caption) read by OCR and searched for the
// private strings the style and the adapter list (account names, email addresses, local paths, tokens). A hit fails
// the take, naming the scene and the frame. The frame per caption is also what the review shows.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAdapter } from "../adapter/load.js";
import type { Mission, Project } from "../model/load.js";
import { effectiveStyle } from "../model/style.js";
import { readTake, takeSceneFiles, type TakeRef } from "../take/take.js";
import { requireTools, run } from "../util/proc.js";

export interface PrivacyHit {
  scene: string;
  t: number;
  frame: string;
  text: string;
  match: string;
}

export interface PrivacyReport {
  ok: boolean;
  checked: string;
  strings: number;
  frames: number;
  hits: PrivacyHit[];
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

async function frameAt(video: string, t: number, out: string) {
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", out]);
}

async function ocr(png: string): Promise<string> {
  return (await run("tesseract", [png, "-", "--psm", "11"])).stdout;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export async function checkPrivacy(ref: TakeRef, project: Project, mission: Mission, log: (m: string) => void = () => {}): Promise<PrivacyReport> {
  await requireTools("ffmpeg", "tesseract");
  const { style } = effectiveStyle(project, mission);
  const adapter = await loadAdapter(project.file.adapter, project.dir);
  const strings = [...style.privacy.strings, ...(adapter?.privateStrings ?? [])].filter(Boolean);
  const scenes = takeSceneFiles(readTake(ref));
  const framesDir = join(ref.dir, "checks", "frames");
  const captionDir = join(ref.dir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(captionDir, { recursive: true });

  const frames: { scene: string; t: number; file: string }[] = [];
  for (const scene of scenes) {
    // One a second, in one pass.
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", scene.video, "-vf", "fps=1", join(framesDir, `${scene.id}-s%04d.png`)]);
    for (const f of readdirSync(framesDir).filter((f) => f.startsWith(`${scene.id}-s`)).sort()) {
      frames.push({ scene: scene.id, t: Number(f.match(/s(\d+)\.png$/)![1]) - 1, file: join(framesDir, f) });
    }
    // One per caption, a second after it comes up (when it has faded in).
    for (const e of scene.events.filter((e) => e.kind === "say")) {
      const t = Math.min(e.t + 1, Math.max(0, scene.duration - 0.1));
      const file = join(captionDir, `${scene.id}-${e.n}.png`);
      await frameAt(scene.video, t, file);
      const copy = join(framesDir, `${scene.id}-c${e.n}.png`);
      copyFileSync(file, copy);
      frames.push({ scene: scene.id, t, file: copy });
    }
  }
  log(`  reading ${frames.length} frames for ${strings.length} private strings`);
  const hits: PrivacyHit[] = [];
  if (strings.length) {
    await pool(frames, 4, async (frame) => {
      const text = await ocr(frame.file);
      const flat = squash(text);
      for (const s of strings) {
        if (flat.includes(squash(s))) {
          const line = text.split("\n").find((l) => squash(l).includes(squash(s))) ?? text.trim().slice(0, 80);
          hits.push({ scene: frame.scene, t: frame.t, frame: frame.file, text: line.trim(), match: s });
        }
      }
    });
  }
  hits.sort((a, b) => a.scene.localeCompare(b.scene) || a.t - b.t);
  // Frames without a hit aren't needed after the check (the caption frames stay, in frames/).
  const keep = new Set(hits.map((h) => h.frame));
  for (const f of frames) if (!keep.has(f.file) && existsSync(f.file)) rmSync(f.file);
  const report: PrivacyReport = { ok: hits.length === 0, checked: new Date().toISOString(), strings: strings.length, frames: frames.length, hits };
  writeFileSync(join(ref.dir, "checks", "privacy.json"), JSON.stringify(report, null, 2));
  return report;
}
