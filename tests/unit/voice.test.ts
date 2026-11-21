import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CutPlan } from "../../src/edit/cutplan.js";
import { voiceGate } from "../../src/pipeline/gates.js";
import { setSceneReview } from "../../src/take/take.js";
import { fakeProvider, type TtsProvider } from "../../src/sound/tts.js";
import { estimate, placeLines, voiceLines, voiceTake } from "../../src/sound/voice.js";
import { recordedTake } from "../helpers/recorded.js";

const say = (t: number, n: number, note: string) => ({ kind: "say" as const, t, title: note, note, scene: "intro", n });

function plan(lines: string[]): CutPlan {
  return {
    segments: [],
    total: 60,
    chapters: [{ key: "01-basics", title: "The basics", start: 0, end: 60 }],
    markers: [
      { kind: "card", t: 0, title: "Demo", note: "A tour.", spoken: "This is the demo.", scene: "opening" },
      ...lines.map((l, i) => say(5 + i * 10, i, l)),
      { kind: "card", t: 55, title: "Music", note: "Calm A by Tester", scene: "credits" },
    ],
  };
}

async function ready(lines: string[]) {
  const r = await recordedTake();
  writeFileSync(join(r.ref.dir, "plan.json"), JSON.stringify(plan(lines)));
  mkdirSync(join(r.ref.dir, "checks"), { recursive: true });
  writeFileSync(join(r.ref.dir, "checks", "privacy.json"), JSON.stringify({ ok: true, hits: [] }));
  return r;
}

function counting(fail?: string): TtsProvider & { bought: string[] } {
  const fake = fakeProvider();
  const bought: string[] = [];
  return {
    id: "test",
    bought,
    async speak(text, voice) {
      if (text === fail) throw new Error(`refused: ${text}`);
      bought.push(text);
      return fake.speak(text, voice);
    },
  };
}

describe("narration lines", () => {
  it("speaks the captions and the opening, not the credits", () => {
    const lines = voiceLines(plan(["One.", "Two."]));
    expect(lines.map((l) => [l.key, l.text])).toEqual([["opening", "This is the demo."], ["intro/0", "One."], ["intro/1", "Two."]]);
  });

  it("places a line after the one before it when they would overlap", () => {
    const placed = placeLines([{ t: 0, text: "a", key: "a", length: 3 }, { t: 1, text: "b", key: "b", length: 1 }]);
    expect(placed[1].at).toBeCloseTo(3.3);
  });

  it("costs nothing when every line is cached", () => {
    const voice = { provider: "fake", model: "tone", voice: "tone", language: "en", price_per_1000: 0.1 };
    expect(estimate([{ t: 0, text: "abc", key: "a" }], voice, () => true).usd).toBe(0);
  });
});

describe("voicing a take", () => {
  const LINES = ["Line one.", "Line two.", "Line three.", "Line four.", "Line five."];

  it("keeps what it bought when a line fails, and buys only the rest on a rerun", async () => {
    const r = await ready(LINES);
    const bad = counting("Line three.");
    const err = await voiceTake(r.ref, r.project, r.mission, { yes: true, provider: bad, concurrency: 1 }).catch((e) => e);
    expect(err.message).toMatch(/Line three\./);
    const spend = readFileSync(join(r.vault, "spend.jsonl"), "utf8").trim().split("\n");
    expect(spend).toHaveLength(3);
    const good = counting();
    const result = await voiceTake(r.ref, r.project, r.mission, { yes: true, provider: good });
    expect(good.bought.sort()).toEqual(["Line five.", "Line four.", "Line three."]);
    expect(existsSync(result.file)).toBe(true);
    expect(result.lines).toHaveLength(6);
  }, 120_000);

  it("refuses to spend without --yes", async () => {
    const r = await ready(["Something new to say."]);
    const err = await voiceTake(r.ref, r.project, r.mission, { provider: counting() }).catch((e) => e);
    expect(err.code).toBe(4);
    expect(err.message).toMatch(/\$/);
  }, 120_000);
});

describe("the voice gate", () => {
  it("refuses a take with a flagged scene unless forced, and a failed privacy check always", async () => {
    const r = await ready(["x"]);
    setSceneReview(r.ref, "intro", "flagged", "too fast", "owner");
    expect(() => voiceGate(r.ref, r.mission, "1.0.0")).toThrow(expect.objectContaining({ code: 3 }));
    expect(() => voiceGate(r.ref, r.mission, "1.0.0", { force: true })).not.toThrow();
    writeFileSync(join(r.ref.dir, "checks", "privacy.json"), JSON.stringify({ ok: false, hits: [{}] }));
    expect(() => voiceGate(r.ref, r.mission, "1.0.0", { force: true })).toThrow(/privacy/);
  }, 120_000);
});

describe("a TTS failure", () => {
  it("names the line even when the provider's error doesn't", async () => {
    const r = await ready(["A line the network drops."]);
    const broken: TtsProvider = { id: "test", async speak() { throw new TypeError("fetch failed"); } };
    const err = await voiceTake(r.ref, r.project, r.mission, { yes: true, provider: broken }).catch((e) => e);
    expect(err.message).toMatch(/fetch failed/);
    expect(err.message).toMatch(/"(This is the demo\.|A line the network drops\.)"/);
  }, 120_000);
});
