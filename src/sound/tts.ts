// Text to speech: providers, a cache shared by every project (a line costs only when its provider, model, voice or
// words changed), and the spend log (~/.reel/spend.jsonl) that every paid call is appended to as soon as it is made.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { VoiceDef } from "../model/schema.js";
import { ReelError, vaultDir } from "../paths.js";
import { run } from "../util/proc.js";
import { tmpdir } from "node:os";

export interface TtsProvider {
  id: string;
  speak(text: string, voice: VoiceDef): Promise<Buffer>;
}

const LANGUAGE_BOOST: Record<string, string> = { en: "English", nl: "Dutch", fr: "French", de: "German", es: "Spanish" };

/** MiniMax speech on Replicate (delve-video's narrator). A throttled request waits 6–10 s and tries again, 10 times. */
export function replicateMinimax(
  token: string,
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): TtsProvider {
  const http = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  return {
    id: "replicate",
    async speak(text, voice) {
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" };
      const body = JSON.stringify({
        input: {
          text,
          voice_id: voice.voice,
          emotion: "auto",
          language_boost: LANGUAGE_BOOST[voice.language] ?? "auto",
          english_normalization: voice.language === "en",
          sample_rate: 44100,
          audio_format: "mp3",
        },
      });
      let prediction: { status?: string; error?: string; detail?: string; output?: string | string[]; urls?: { get: string } };
      for (let tries = 0; ; tries++) {
        const response = await http(`https://api.replicate.com/v1/models/${voice.model}/predictions`, { method: "POST", headers, body });
        prediction = await response.json();
        if (response.status !== 429 || tries >= 10) break;
        await sleep(6000 + Math.random() * 4000);
      }
      while (prediction.status === "starting" || prediction.status === "processing") {
        await sleep(1000);
        prediction = await (await http(prediction.urls!.get, { headers })).json();
      }
      if (prediction.status !== "succeeded") {
        throw new ReelError(1, `Replicate: ${prediction.status ?? "refused"} for "${text}": ${prediction.error ?? prediction.detail ?? ""}`);
      }
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output!;
      const audio = await http(url);
      if (!audio.ok) throw new ReelError(1, `Replicate: downloading ${url}: ${audio.status}`);
      return Buffer.from(await audio.arrayBuffer());
    },
  };
}

/** A tone 0.06 s per character long, for tests and for trying a film out without paying. */
export function fakeProvider(): TtsProvider {
  return {
    id: "fake",
    async speak(text) {
      const file = join(tmpdir(), `reel-fake-${randomUUID()}.mp3`);
      const d = Math.max(0.3, 0.06 * text.length).toFixed(2);
      await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=f=440:d=${d}`, "-ar", "44100", file]);
      return readFileSync(file);
    },
  };
}

export function replicateToken(): string | undefined {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  const file = join(vaultDir(), "secrets", "replicate.yaml");
  if (!existsSync(file)) return undefined;
  return parse(readFileSync(file, "utf8"))?.token;
}

/** The provider for a voice. REEL_TTS=fake makes every voice the fake one (tests, trying out). */
export function providerFor(voice: VoiceDef): TtsProvider {
  if (process.env.REEL_TTS === "fake" || voice.provider === "fake") return fakeProvider();
  if (voice.provider === "replicate") {
    const token = replicateToken();
    if (!token) throw new ReelError(1, "No Replicate token: set REPLICATE_API_TOKEN or ~/.reel/secrets/replicate.yaml (token: r8_...)");
    return replicateMinimax(token);
  }
  throw new ReelError(1, `unknown TTS provider "${voice.provider}"`);
}

export const voiceCacheDir = () => join(vaultDir(), "voice-cache");

/** The cached file of a line: keyed by the provider that speaks it (so test tones never stand in for a real voice). */
export function cacheFile(voice: VoiceDef, text: string, provider: string): string {
  const key = createHash("sha256").update(`${provider}|${voice.model}|${voice.voice}|${text}`).digest("hex").slice(0, 16);
  return join(voiceCacheDir(), `${key}.mp3`);
}

export interface SpendEntry {
  at: string;
  project: string;
  mission: string;
  take?: number;
  provider: string;
  model: string;
  voice: string;
  characters: number;
  usd: number;
  text: string;
}

export const spendFile = () => join(vaultDir(), "spend.jsonl");

export function priceOf(voice: VoiceDef, characters: number): number {
  return Math.round(voice.price_per_1000 * (characters / 1000) * 10000) / 10000;
}

export function readSpend(): SpendEntry[] {
  if (!existsSync(spendFile())) return [];
  return readFileSync(spendFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** A line from the cache, or bought from the provider (and logged as spent) and cached. */
export async function speakCached(
  text: string,
  voice: VoiceDef,
  provider: TtsProvider,
  who: { project: string; mission: string; take?: number },
): Promise<{ file: string; bought: boolean }> {
  const file = cacheFile(voice, text, provider.id);
  if (existsSync(file)) return { file, bought: false };
  const audio = await provider.speak(text, voice);
  mkdirSync(voiceCacheDir(), { recursive: true });
  writeFileSync(file, audio);
  if (provider.id !== "fake") {
    const entry: SpendEntry = { at: new Date().toISOString(), ...who, provider: voice.provider, model: voice.model, voice: voice.voice,
      characters: text.length, usd: priceOf(voice, text.length), text: text.slice(0, 80) };
    appendFileSync(spendFile(), `${JSON.stringify(entry)}\n`);
  }
  return { file, bought: true };
}
