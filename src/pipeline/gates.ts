// What must be true before money is spent on a take: its privacy check passed (always), and no scene is flagged or
// stale (unless forced). Unreviewed scenes are fine: the review also needs the finished mix.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mission } from "../model/load.js";
import { ReelError } from "../paths.js";
import { readReview, staleScenes, type TakeRef } from "../take/take.js";

export function voiceGate(ref: TakeRef, mission: Mission, adapterVersion: string, { force = false } = {}): void {
  const name = `${ref.project}/${ref.mission}/${ref.n}`;
  const file = join(ref.dir, "checks", "privacy.json");
  if (!existsSync(file)) throw new ReelError(3, `take ${name} has no privacy check yet: run \`reel check ${name}\` first`);
  const privacy = JSON.parse(readFileSync(file, "utf8")) as { ok: boolean; hits: unknown[] };
  if (!privacy.ok) throw new ReelError(3, `take ${name} failed its privacy check (${privacy.hits.length} hits); --force does not lift this`);
  if (force) return;
  const flagged = Object.entries(readReview(ref).scenes).filter(([, r]) => r.state === "flagged").map(([id]) => id);
  if (flagged.length) throw new ReelError(3, `take ${name} has flagged scenes (${flagged.join(", ")}): retake them (\`reel record ${ref.project}/${ref.mission} --flagged\`) or pass --force`);
  const stale = staleScenes(mission, ref, adapterVersion);
  if (stale.length) throw new ReelError(3, `take ${name} has stale scenes (${stale.join(", ")}): record them again or pass --force`);
}
