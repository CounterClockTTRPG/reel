// Before the UI tests: a studio with one recorded, checked and cut take, and `reel serve` on it (port 7791).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPrivacy } from "../../src/check/privacy.js";
import { cutTake } from "../../src/edit/join.js";
import { recordedTake } from "../helpers/recorded.js";

export const PORT = 7791;
export const STATE = join(import.meta.dirname, ".state.json");

export default async function setup() {
  const r = await recordedTake();
  await checkPrivacy(r.ref, r.project, r.mission);
  await cutTake(r.ref, r.project, r.mission);
  const server = spawn(process.execPath, [join(import.meta.dirname, "..", "..", "dist", "cli", "main.js"), "serve", "--port", String(PORT)], {
    env: { ...process.env, REEL_STUDIO: r.studio, REEL_DATA: r.vault, REEL_TTS: "fake" },
    stdio: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/api/studio`, { headers: { host: "localhost" } }).then((x) => x.ok, () => false);
    if (up) break;
    await new Promise((d) => setTimeout(d, 200));
  }
  writeFileSync(STATE, JSON.stringify({ studio: r.studio, vault: r.vault, take: r.ref.dir }));
  return async () => {
    server.kill();
  };
}
