// Recorded scenes are kept in the vault, keyed by what makes them look the way they do: the scene's steps and words,
// the adapter's version, the app's address and the picture size. A scene whose key is unchanged is reused.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scene } from "../model/schema.js";
import { vaultDir } from "../paths.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export function sceneKey(scene: Scene, adapterVersion: string, base: string, size: { width: number; height: number }): string {
  const text = JSON.stringify(canonical({ scene, adapterVersion, base, size }));
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export interface RecordingInfo {
  id: string;
  scene: string;
  key: string;
  made: string;
  duration: number;
  seats: string[];
}

export const scenesRoot = (project: string, mission: string, scene: string) => join(vaultDir(), "scenes", project, mission, scene);

/** The newest recording of a scene with this key, if any. */
export function cachedRecording(project: string, mission: string, scene: string, key: string): RecordingInfo | null {
  const root = scenesRoot(project, mission, scene);
  if (!existsSync(root)) return null;
  for (const id of readdirSync(root).sort().reverse()) {
    const file = join(root, id, "recording.json");
    if (!existsSync(file)) continue;
    const info = JSON.parse(readFileSync(file, "utf8")) as RecordingInfo;
    if (info.key === key) return info;
  }
  return null;
}

export function readRecording(project: string, mission: string, scene: string, id: string): RecordingInfo {
  return JSON.parse(readFileSync(join(scenesRoot(project, mission, scene), id, "recording.json"), "utf8"));
}

/** A recording id: the time it was made, sortable. */
export function newRecordingId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
}
