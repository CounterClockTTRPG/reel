// `reel make`: check, cut, voice, mix and package a take, stopping at the first step that fails (with its exit code).
// What the narration would cost is said before any of it runs.
import { existsSync } from "node:fs";
import { checkPrivacy } from "../check/privacy.js";
import { cutTake } from "../edit/join.js";
import { sourceLines } from "../i18n/translations.js";
import { voiceNamed } from "../library/voices.js";
import type { Mission, Project } from "../model/load.js";
import { effectiveStyle } from "../model/style.js";
import { ReelError } from "../paths.js";
import { packageTake } from "../pub/package.js";
import { mixTake } from "../sound/mix.js";
import { cacheFile, providerFor, type TtsProvider } from "../sound/tts.js";
import { estimate, voiceTake } from "../sound/voice.js";
import type { TakeRef } from "../take/take.js";

export interface MakeOptions {
  yes?: boolean;
  budget?: number;
  force?: boolean;
  allowMissing?: boolean;
  provider?: TtsProvider;
  log?: (m: string) => void;
}

export async function makeTake(ref: TakeRef, project: Project, mission: Mission, opts: MakeOptions = {}) {
  const log = opts.log ?? (() => {});
  const { style } = effectiveStyle(project, mission);
  const voice = await voiceNamed(project.studio, style.voice);
  const provider = opts.provider ?? providerFor(voice);
  // Before anything: the most the narration can cost (every caption; the cut may drop some inside cut waits).
  const lines = Object.entries(sourceLines(mission)).map(([key, text]) => ({ key, text, t: 0 }));
  const est = estimate(lines, voice, (t) => existsSync(cacheFile(voice, t, provider.id)));
  log(est.toBuy
    ? `Narration: would spend at most $${est.usd.toFixed(4)} on ${est.toBuy} lines (${est.characters} characters)${opts.yes ? "" : "; pass --yes to spend it"}`
    : "Narration: every line is cached, nothing to spend");

  const steps: { name: string; ok: boolean; ms: number }[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    log(`${name}…`);
    try {
      await fn();
      steps.push({ name, ok: true, ms: Date.now() - start });
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - start });
      if (e instanceof ReelError) e.details = { ...e.details, steps };
      throw e;
    }
  };
  await step("check", async () => {
    const report = await checkPrivacy(ref, project, mission, log);
    if (!report.ok) throw new ReelError(3, `the privacy check found ${report.hits.length} private strings on screen (run \`reel check\` for the frames)`);
  });
  await step("cut", () => cutTake(ref, project, mission, log));
  await step("voice", () => voiceTake(ref, project, mission, { yes: opts.yes, budget: opts.budget, force: opts.force, provider, log }));
  await step("mix", async () => {
    const { loudness } = await mixTake(ref, project, mission, log);
    if (!loudness.ok) throw new ReelError(3, `the music comes within ${loudness.margin} dB of the speech (at least ${loudness.required} wanted)`);
  });
  await step("package", () => packageTake(ref, project, mission, { allowMissing: opts.allowMissing, log }));
  return { steps };
}
