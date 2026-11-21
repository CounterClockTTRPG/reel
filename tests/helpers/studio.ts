import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./tmp.js";

export const FIXTURE_STUDIO = join(import.meta.dirname, "..", "fixtures", "studio");
export const FIXTURE_ADAPTER = join(import.meta.dirname, "..", "fixtures", "adapter", "index.js");

/** A writable copy of the fixture studio, its adapter path made absolute (to the fixture adapter). */
export function studioCopy(): string {
  const dir = join(tmp("reel-studio-"), "studio");
  cpSync(FIXTURE_STUDIO, dir, { recursive: true });
  const project = join(dir, "projects", "demo", "project.yaml");
  writeFileSync(project, readFileSync(project, "utf8").replace(/^adapter: .*$/m, `adapter: ${JSON.stringify(FIXTURE_ADAPTER)}`));
  return dir;
}
