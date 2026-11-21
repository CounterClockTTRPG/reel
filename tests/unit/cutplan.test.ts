import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../src/adapter/api.js";
import { planCut, type CutInput } from "../../src/edit/cutplan.js";

const T = { chapter: { kind: "fadeblack", length: 1 }, card: { kind: "fade", length: 1 }, cut: { kind: "fade", length: 0.5 } };
const say = (scene: string, t: number, n = 0): TimelineEvent => ({ kind: "say", t, title: "x", note: `line ${t}`, scene, n });
const wait = (scene: string, t: number, end: number): TimelineEvent => ({ kind: "wait", t, end, title: "Waiting (cut)", scene });

function input(over: Partial<CutInput> = {}): CutInput {
  return {
    opening: null,
    closing: null,
    credits: null,
    interstitials: false,
    cutWaits: true,
    transitions: T,
    chapters: [{ key: "c1", title: "One", scenes: [{ id: "a", video: "a.mp4", duration: 60, events: [wait("a", 10, 40), say("a", 45)] }] }],
    ...over,
  };
}

describe("the cut plan", () => {
  it("cuts a long wait, keeping 4 s of its start and 1.2 s of its end", () => {
    const plan = planCut(input());
    const scenes = plan.segments.filter((s) => s.kind === "scene");
    expect(scenes.map((s) => [s.from, s.length])).toEqual([[0, 14], [38.8, 21.2]]);
    expect(scenes[1].transition).toEqual({ kind: "fade", length: 0.5 });
  });

  it("moves the captions after a cut onto the film's clock", () => {
    const plan = planCut(input());
    const line = plan.markers.find((m) => m.kind === "say")!;
    // 45 s in the recording: 14 s kept before the cut, a 0.5 s crossfade, then 6.2 s into the second clip.
    expect(line.t).toBeCloseTo(45 - (38.8 - 14) - 0.5);
    expect(plan.markers.some((m) => m.kind === "wait")).toBe(false);
  });

  it("leaves a short wait alone", () => {
    const plan = planCut(input({ chapters: [{ key: "c1", title: "One", scenes: [{ id: "a", video: "a.mp4", duration: 30, events: [wait("a", 10, 15)] }] }] }));
    expect(plan.segments.filter((s) => s.kind === "scene")).toHaveLength(1);
  });

  it("speeds a wait up with a badge where the scene asks", () => {
    const plan = planCut(input({ chapters: [{ key: "c1", title: "One", scenes: [{ id: "a", video: "a.mp4", duration: 60, speed: 3, events: [wait("a", 10, 40)] }] }] }));
    const fast = plan.segments.find((s) => s.speed === 3)!;
    expect(fast.length).toBe(10);
    expect(fast.badge).toBe("×3");
  });

  it("marks each chapter where its first segment starts", () => {
    const scene = (id: string) => ({ id, video: `${id}.mp4`, duration: 20, events: [] });
    const plan = planCut(input({
      opening: { title: "Film", hold: 5 },
      interstitials: true,
      chapters: [{ key: "c1", title: "One", scenes: [scene("a")] }, { key: "c2", title: "Two", scenes: [scene("b")] }],
    }));
    const cards = plan.segments.filter((s) => s.kind === "card");
    expect(plan.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(plan.chapters[0].start).toBe(cards[1].start);
    expect(plan.chapters[1].start).toBe(cards[2].start);
    expect(cards[2].card!.number).toBe("Chapter 2");
    const overlaps = plan.segments.reduce((n, s) => n + (s.transition?.length ?? 0), 0);
    expect(plan.total).toBeCloseTo(plan.segments.reduce((n, s) => n + s.length, 0) - overlaps);
  });
});

describe("short stretches", () => {
  it("leaves no clip shorter than twice its crossfade between back-to-back waits", () => {
    const plan = planCut(input({ chapters: [{ key: "c1", title: "One", scenes: [{ id: "a", video: "a.mp4", duration: 41, speed: 3,
      events: [wait("a", 5, 20), wait("a", 20.1, 35), wait("a", 35, 40.9)] }] }] }));
    for (const s of plan.segments.filter((x) => x.kind === "scene")) expect(s.length).toBeGreaterThanOrEqual(1);
    const shown = plan.segments.filter((x) => x.kind === "scene").reduce((n, s) => n + s.length * (s.speed ?? 1), 0);
    expect(shown).toBeCloseTo(41, 0);
  });
});
