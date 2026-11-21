// A mission's effective style: the defaults, then the project's style, then the mission's, merged key by key
// (objects merge, lists and values are replaced). `sources` says where each value came from, for the web UI.
import type { Mission, Project } from "./load.js";
import { Style, type PartialStyle } from "./schema.js";

export const DEFAULT_STYLE: Style = {
  voice: "",
  languages: ["en"],
  music: { moods: [], loudness: -33 },
  loudness: { voice: -16, music_under: 17, check_margin: 12 },
  overlay: "classic",
  cards: { opening: "classic", chapter: "classic", credits: "classic" },
  transitions: { chapter: "fade-black", card: "crossfade", cut: "crossfade-short" },
  size: { width: 1920, height: 1080 },
  privacy: { masks: [], strings: [] },
};

export type Source = "default" | "project" | "mission";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function leaves(value: unknown, prefix = ""): [string, unknown][] {
  if (!isObject(value)) return [[prefix, value]];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

function merge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(base[k]) ? merge(base[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

export function effectiveStyle(project: Project, mission?: Mission): { style: Style; sources: Record<string, Source> } {
  const layers: [Source, PartialStyle][] = [["project", project.file.style], ["mission", mission?.file.style ?? {}]];
  let style = DEFAULT_STYLE as unknown as Record<string, unknown>;
  const sources: Record<string, Source> = Object.fromEntries(leaves(DEFAULT_STYLE).map(([k]) => [k, "default" as Source]));
  for (const [source, layer] of layers) {
    style = merge(style, layer as Record<string, unknown>);
    for (const [k] of leaves(layer)) sources[k] = source;
  }
  return { style: Style.parse(style), sources };
}
