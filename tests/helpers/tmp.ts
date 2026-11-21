import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temporary directory for one test. */
export function tmp(prefix = "reel-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
