import { describe, expect, it } from "vitest";
import { fakeProvider, replicateMinimax } from "../../src/sound/tts.js";
import { probeDuration } from "../../src/util/proc.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "../helpers/tmp.js";

const voice = { provider: "replicate", model: "minimax/speech-02-hd", voice: "English_Wiselady", language: "en", price_per_1000: 0.1 };

describe("TTS providers", () => {
  it("retries a throttled Replicate request", async () => {
    const posts: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        if (posts.length < 3) return new Response(JSON.stringify({ detail: "throttled" }), { status: 429 });
        return new Response(JSON.stringify({ status: "succeeded", output: "https://example/audio.mp3" }), { status: 201 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    const provider = replicateMinimax("r8_x", { fetch: fetchImpl, sleep: async () => {} });
    const audio = await provider.speak("Hello there.", voice);
    expect(posts).toHaveLength(3);
    expect((posts[0] as { input: { voice_id: string } }).input.voice_id).toBe("English_Wiselady");
    expect([...audio]).toEqual([1, 2, 3]);
  });

  it("names the refused line when Replicate fails", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ status: "failed", error: "no credit" }), { status: 201 })) as typeof fetch;
    const provider = replicateMinimax("r8_x", { fetch: fetchImpl, sleep: async () => {} });
    await expect(provider.speak("A line that fails.", voice)).rejects.toThrow(/A line that fails.*no credit/);
  });

  it("makes a tone as long as the text for tests", async () => {
    const file = join(tmp(), "a.mp3");
    writeFileSync(file, await fakeProvider().speak("x".repeat(50), { ...voice, provider: "fake" }));
    expect(await probeDuration(file)).toBeCloseTo(3, 0);
  });
});
