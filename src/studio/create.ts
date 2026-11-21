// Making things in the studio: a new studio from the template, a project, a mission. What they write is validated
// by loading it back, so a new mission always loads.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMission, loadProject, loadStudio, type Project, type Studio } from "../model/load.js";
import { assertSlug, ReelError } from "../paths.js";

export const TEMPLATE = join(import.meta.dirname, "..", "..", "templates", "studio");

export function initStudio(dir: string): void {
  if (existsSync(join(dir, "studio.yaml"))) throw new ReelError(2, `${dir} is a studio already`);
  mkdirSync(dir, { recursive: true });
  cpSync(TEMPLATE, dir, { recursive: true });
}

export async function createProject(studio: Studio, key: string, o: { name?: string; adapter?: string; base: string }): Promise<Project> {
  assertSlug(key, "project");
  const dir = join(studio.dir, "projects", key);
  if (existsSync(join(dir, "project.yaml"))) throw new ReelError(2, `project ${key} exists already`);
  mkdirSync(join(dir, "missions"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), [
    `name: ${JSON.stringify(o.name ?? key)}`,
    ...(o.adapter ? [`adapter: ${JSON.stringify(o.adapter)}   # a path (relative to this folder) or a package name`] : ["# adapter: ../../../my-adapter   # an adapter plugin for this application's own steps"]),
    "app:",
    `  base: ${o.base}`,
    "  auth: none                 # none | token (REEL_TOKEN_<KEY> or ~/.reel/secrets/<key>.yaml) | login (reel login)",
    "  local_storage: {}          # set before the app's own scripts (e.g. to keep welcome tours off camera)",
    "style:                       # what every mission inherits; a mission's own style: overrides it key by key",
    "  voice: wise-lady",
    "  languages: [en]            # the first is the narration's; each gets an .srt",
    "  music: { moods: [], loudness: -33 }",
    "  privacy:",
    "    masks: []                # selectors hidden while recording",
    "    strings: []              # searched for by OCR in every take",
    "",
  ].join("\n"));
  return loadProject(await loadStudio(studio.dir), key);
}

export async function createMission(project: Project, key: string, o: { title: string }) {
  assertSlug(key, "mission");
  const dir = join(project.dir, "missions", key);
  if (existsSync(join(dir, "mission.yaml"))) throw new ReelError(2, `mission ${project.key}/${key} exists already`);
  mkdirSync(join(dir, "chapters"), { recursive: true });
  mkdirSync(join(dir, "translations"), { recursive: true });
  writeFileSync(join(dir, "mission.yaml"), [
    `title: ${JSON.stringify(o.title)}`,
    `opening: { title: ${JSON.stringify(o.title)}, text: "" }`,
    "chapters: [01-start]",
    "cut_waits: true              # marked waits are cut (keep 4 s of the start, 1.2 s of the end)",
    "interstitials: false         # a chapter card before each chapter",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "chapters", "01-start.yaml"), [
    "title: Start",
    "scenes:",
    "  - id: welcome",
    "    steps:",
    "      - goto: /",
    "      - say: Welcome.",
    "",
  ].join("\n"));
  return loadMission(project, key);
}
