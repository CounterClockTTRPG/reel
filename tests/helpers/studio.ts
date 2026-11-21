import { cpSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./tmp.js";

export const FIXTURE_STUDIO = join(import.meta.dirname, "..", "fixtures", "studio");

/** A writable copy of the fixture studio (its adapter path is rewritten to the fixture adapter). */
export function studioCopy(): string {
  const dir = join(tmp("reel-studio-"), "studio");
  cpSync(FIXTURE_STUDIO, dir, { recursive: true });
  return dir;
}
