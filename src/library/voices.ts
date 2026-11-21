// The voices library: library/voices.yaml, named narrators (provider, model, voice id, price).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseFile, type Studio } from "../model/load.js";
import { Voices, type VoiceDef } from "../model/schema.js";
import { ReelError } from "../paths.js";

export async function loadVoices(studio: Studio): Promise<Voices> {
  const file = join(studio.dir, "library", "voices.yaml");
  if (!existsSync(file)) return { voices: {} };
  return (await parseFile(Voices, file, studio.dir)).value;
}

export async function voiceNamed(studio: Studio, name: string): Promise<VoiceDef> {
  const voice = (await loadVoices(studio)).voices[name];
  if (!voice) throw new ReelError(1, `no voice "${name}" in library/voices.yaml`);
  return voice;
}
