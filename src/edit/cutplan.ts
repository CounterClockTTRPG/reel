// The cut plan: which stretches of which recordings make the film, in what order, with which transitions, and where
// every caption lands on the film's clock. Pure (no I/O): the join (join.ts) turns it into one ffmpeg run.
//
// The rules are delve-video's join.mjs: a marked wait longer than KEEP_BEFORE + KEEP + 1 s is cut, keeping its first
// 4 s (to read the caption over it) and its last 1.2 s, with a short crossfade; a scene with `speed` plays its waits
// faster with a badge instead. A crossfade overlaps two segments by its length.
import type { TimelineEvent } from "../adapter/api.js";
import { readingTime } from "../record/stage.js";

export const KEEP_BEFORE = 4;
export const KEEP = 1.2;
/** How long a chapter's interstitial card is up. */
export const CARD = 4.5;

export interface Transition {
  kind: string;
  length: number;
}

export interface CardSpec {
  title: string;
  text?: string;
  spoken?: string;
  hold?: number;
  number?: string;
  small?: boolean;
  /** Which of the style's card templates: opening, chapter or credits. */
  template?: "opening" | "chapter" | "credits";
}

export interface CutScene {
  id: string;
  video: string;
  duration: number;
  events: TimelineEvent[];
  speed?: number;
}

export interface CutChapter {
  key: string;
  title: string;
  text?: string;
  scenes: CutScene[];
}

export interface CutInput {
  opening: CardSpec | null;
  closing: CardSpec | null;
  credits: CardSpec | null;
  chapters: CutChapter[];
  cutWaits: boolean;
  interstitials: boolean;
  transitions: { chapter: Transition; card: Transition; cut: Transition };
}

export interface Segment {
  kind: "card" | "scene";
  card?: CardSpec;
  scene?: string;
  chapter?: string;
  source?: string;
  /** Where the segment starts in its source (seconds of recording). */
  from: number;
  /** How long it is in the film. */
  length: number;
  /** Where it starts on the film's clock. */
  start: number;
  /** How it comes in from the segment before (null for the first). */
  transition: Transition | null;
  speed?: number;
  badge?: string;
}

/** A marker on the film's clock: a timeline event moved, or a card. */
export type FilmMarker = TimelineEvent & { chapter?: string };

export interface CutPlan {
  segments: Segment[];
  total: number;
  markers: FilmMarker[];
  chapters: { key: string; title: string; start: number; end: number }[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function cardLength(card: CardSpec, fallback?: number): number {
  return card.hold ?? fallback ?? Math.max(CARD, readingTime(`${card.title} ${card.text ?? ""}`));
}

/** The stretches of one scene that stay: [from, length, speed]. */
function sceneClips(scene: CutScene, cutWaits: boolean): { from: number; to: number; speed: number }[] {
  const waits = scene.events
    .filter((e) => e.kind === "wait" && e.end !== undefined)
    .sort((a, b) => a.t - b.t);
  const clips: { from: number; to: number; speed: number }[] = [];
  let start = 0;
  for (const w of waits) {
    const end = Math.min(w.end!, scene.duration);
    if (w.t < start) continue;
    if (scene.speed) {
      if (end - w.t < 1) continue;
      if (w.t > start) clips.push({ from: start, to: w.t, speed: 1 });
      clips.push({ from: w.t, to: end, speed: scene.speed });
      start = end;
    } else if (cutWaits && end - w.t > KEEP_BEFORE + KEEP + 1) {
      clips.push({ from: start, to: w.t + KEEP_BEFORE, speed: 1 });
      start = end - KEEP;
    }
  }
  if (scene.duration > start) clips.push({ from: start, to: scene.duration, speed: 1 });
  return clips;
}

export function planCut(input: CutInput): CutPlan {
  const segments: Omit<Segment, "start">[] = [];
  const { transitions: T } = input;
  const push = (s: Omit<Segment, "start" | "transition">, transition: Transition) =>
    segments.push({ ...s, transition: segments.length ? transition : null });

  if (input.opening) push({ kind: "card", card: { template: "opening", ...input.opening }, from: 0, length: cardLength(input.opening) }, T.card);
  input.chapters.forEach((chapter, ci) => {
    const into = segments.length && segments.at(-1)!.kind === "scene" ? T.chapter : T.card;
    if (input.interstitials) {
      const card: CardSpec = { template: "chapter", title: chapter.title, text: chapter.text, number: `Chapter ${ci + 1}` };
      push({ kind: "card", card, chapter: chapter.key, from: 0, length: CARD }, into);
    }
    chapter.scenes.forEach((scene, si) => {
      sceneClips(scene, input.cutWaits).forEach((clip, k) => {
        const first = si === 0 && k === 0;
        const transition = first ? (input.interstitials ? T.card : into) : T.cut;
        push(
          {
            kind: "scene",
            scene: scene.id,
            chapter: chapter.key,
            source: scene.video,
            from: round(clip.from),
            length: round((clip.to - clip.from) / clip.speed),
            ...(clip.speed !== 1 ? { speed: clip.speed, badge: `×${clip.speed}` } : {}),
          },
          transition,
        );
      });
    });
  });
  if (input.closing) push({ kind: "card", card: { template: "opening", ...input.closing }, from: 0, length: cardLength(input.closing) }, T.chapter);
  if (input.credits) push({ kind: "card", card: { template: "credits", small: true, ...input.credits }, from: 0, length: cardLength(input.credits, 7) }, T.card);

  // Each segment starts where the one before ends, less the crossfade into it.
  const placed: Segment[] = [];
  let at = 0;
  for (const s of segments) {
    const start = placed.length ? at - (s.transition?.length ?? 0) : 0;
    placed.push({ ...s, start: round(start) });
    at = start + s.length;
  }
  const total = round(at);

  const markers: FilmMarker[] = [];
  for (const s of placed) {
    if (s.kind === "card") {
      markers.push({
        kind: "card",
        t: s.start,
        title: s.card!.number ? `${s.card!.number}: ${s.card!.title}` : s.card!.title,
        note: s.card!.text ?? "",
        ...(s.card!.spoken ? { spoken: s.card!.spoken } : {}),
        scene: s.card!.template === "credits" ? "credits" : s.card!.template === "chapter" ? `${s.chapter}/chapter` : "opening",
        ...(s.chapter ? { chapter: s.chapter } : {}),
      });
      continue;
    }
    const scene = input.chapters.flatMap((c) => c.scenes).find((sc) => sc.id === s.scene)!;
    const speed = s.speed ?? 1;
    const to = s.from + s.length * speed;
    for (const e of scene.events) {
      if (e.kind === "wait" || e.t < s.from || e.t >= to) continue;
      markers.push({ ...e, t: round(s.start + (e.t - s.from) / speed), ...(e.end !== undefined ? { end: round(s.start + (Math.min(e.end, to) - s.from) / speed) } : {}), chapter: s.chapter });
    }
  }
  markers.sort((a, b) => a.t - b.t);

  const chapters = input.chapters.map((c) => {
    const own = placed.filter((s) => s.chapter === c.key);
    return { key: c.key, title: c.title, start: own[0]?.start ?? 0, end: round((own.at(-1)?.start ?? 0) + (own.at(-1)?.length ?? 0)) };
  });
  return { segments: placed, total, markers, chapters };
}
