// Loading the studio: studio.yaml, projects, missions, chapters and translations, each validated, with errors that say
// file:line and the scene.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { z } from "zod";
import { ReelError, studioDir } from "../paths.js";
import { lineAt, readYamlDoc, type YamlDoc } from "../util/yamlfile.js";
import {
  ChapterFile,
  CORE_STEP_ARGS,
  MissionFile,
  ProjectFile,
  STEP_COMMON_KEYS,
  StudioFile,
  TranslationFile,
  type Step,
} from "./schema.js";

/** A mistake in a studio file: where it is (file, line, scene) and what is wrong. */
export class FilmError extends ReelError {
  constructor(
    public file: string,
    public line: number,
    detail: string,
    public scene?: string,
  ) {
    super(1, `${file}:${line}${scene ? ` (scene "${scene}")` : ""}: ${detail}`, { file, line, scene });
    this.name = "FilmError";
  }
}

export interface ProjectSummary {
  key: string;
  name: string;
  missions: string[];
}

export interface Studio {
  dir: string;
  file: StudioFile;
  projects: ProjectSummary[];
}

export interface Project {
  key: string;
  dir: string;
  studio: Studio;
  file: ProjectFile;
  mtimeMs: number;
}

export interface Chapter {
  key: string;
  path: string;
  file: ChapterFile;
  mtimeMs: number;
}

export interface Mission {
  key: string;
  dir: string;
  project: Project;
  file: MissionFile;
  mtimeMs: number;
  chapters: Chapter[];
  translations: Record<string, z.infer<typeof TranslationFile>>;
}

const rel = (studio: string, file: string) => relative(studio, file).replaceAll("\\", "/");

/** Reads `file` and validates it with `schema`, turning the first problem into a FilmError at its line. */
export async function parseFile<S extends z.ZodTypeAny>(
  schema: S,
  file: string,
  studio: string,
): Promise<{ value: z.infer<S>; yaml: YamlDoc }> {
  if (!existsSync(file)) throw new FilmError(rel(studio, file), 1, "file not found");
  const yaml = await readYamlDoc(file);
  if (yaml.doc.errors.length) {
    const e = yaml.doc.errors[0];
    throw new FilmError(rel(studio, file), e.linePos?.[0]?.line ?? 1, e.message.split("\n")[0]);
  }
  const result = schema.safeParse(yaml.doc.toJS() ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path as (string | number)[];
    throw new FilmError(rel(studio, file), lineAt(yaml, path), `${path.join(".") || "(top)"}: ${issue.message}`, sceneOf(yaml, path));
  }
  return { value: result.data, yaml };
}

function sceneOf(yaml: YamlDoc, path: (string | number)[]): string | undefined {
  if (path[0] !== "scenes" || typeof path[1] !== "number") return undefined;
  const id = yaml.doc.getIn(["scenes", path[1], "id"]);
  return typeof id === "string" ? id : undefined;
}

/** The action of a step: its one key that isn't a common key (or the bare string). */
export function stepAction(step: Step): { name: string; args: unknown } {
  if (typeof step === "string") return { name: step, args: null };
  const keys = Object.keys(step).filter((k) => !(STEP_COMMON_KEYS as readonly string[]).includes(k));
  if (keys.length !== 1) {
    throw new Error(keys.length ? `one action per step, found ${keys.join(", ")}` : "a step needs an action");
  }
  return { name: keys[0], args: step[keys[0]] ?? null };
}

/** Checks a core step's arguments (adapter steps, with a dot, are checked when the adapter is loaded). */
export function checkStep(step: Step): string | null {
  let action;
  try {
    action = stepAction(step);
  } catch (e) {
    return (e as Error).message;
  }
  if (action.name.includes(".")) return null;
  if (action.name === "parallel") {
    if (!Array.isArray(action.args) || !action.args.every(Array.isArray)) return "parallel takes a list of step lists";
    for (const list of action.args as Step[][]) for (const s of list) {
      const problem = checkStep(s);
      if (problem) return `parallel: ${problem}`;
    }
    return null;
  }
  const schema = CORE_STEP_ARGS[action.name as keyof typeof CORE_STEP_ARGS];
  if (!schema) return `unknown step "${action.name}"`;
  const result = schema.safeParse(action.args);
  return result.success ? null : `${action.name}: ${result.error.issues[0].message}`;
}

export async function loadStudio(dir = studioDir()): Promise<Studio> {
  const file = join(dir, "studio.yaml");
  if (!existsSync(file)) throw new ReelError(2, `No studio at ${dir} (no studio.yaml): run \`reel init\` or set REEL_STUDIO`);
  const { value } = await parseFile(StudioFile, file, dir);
  const projects: ProjectSummary[] = [];
  const root = join(dir, "projects");
  if (existsSync(root)) {
    for (const key of (await readdir(root)).sort()) {
      const pf = join(root, key, "project.yaml");
      if (!existsSync(pf)) continue;
      const { value: p } = await parseFile(ProjectFile, pf, dir);
      const md = join(root, key, "missions");
      const missions = existsSync(md)
        ? (await readdir(md)).filter((m) => existsSync(join(md, m, "mission.yaml"))).sort()
        : [];
      projects.push({ key, name: p.name, missions });
    }
  }
  return { dir, file: value, projects };
}

export async function loadProject(studio: Studio, key: string): Promise<Project> {
  const dir = join(studio.dir, "projects", key);
  const file = join(dir, "project.yaml");
  if (!existsSync(file)) throw new ReelError(2, `No project "${key}" in the studio`);
  const { value, yaml } = await parseFile(ProjectFile, file, studio.dir);
  return { key, dir, studio, file: value, mtimeMs: yaml.mtimeMs };
}

export async function loadMission(project: Project, key: string): Promise<Mission> {
  const studio = project.studio.dir;
  const dir = join(project.dir, "missions", key);
  const mfile = join(dir, "mission.yaml");
  if (!existsSync(mfile)) throw new ReelError(2, `No mission "${project.key}/${key}" in the studio`);
  const { value: file, yaml: myaml } = await parseFile(MissionFile, mfile, studio);
  const chapters: Chapter[] = [];
  const seen = new Map<string, string>();
  for (const ck of file.chapters) {
    const path = join(dir, "chapters", `${ck}.yaml`);
    const { value, yaml } = await parseFile(ChapterFile, path, studio);
    const where = rel(studio, path);
    const checkList = (steps: Step[], base: (string | number)[], scene?: string) => {
      steps.forEach((step, i) => {
        const problem = checkStep(step);
        if (problem) throw new FilmError(where, lineAt(yaml, [...base, i]), `steps.${i}: ${problem}`, scene);
      });
    };
    checkList(value.setup, ["setup"]);
    checkList(value.teardown, ["teardown"]);
    value.scenes.forEach((scene, si) => {
      const before = seen.get(scene.id);
      if (before) {
        throw new FilmError(where, lineAt(yaml, ["scenes", si, "id"]), `scene id "${scene.id}" is also used in ${before}`, scene.id);
      }
      seen.set(scene.id, where);
      checkList(scene.steps, ["scenes", si, "steps"], scene.id);
      const first = stepAction(scene.steps[0]).name;
      if (first !== "goto" && first !== "parallel" && !first.includes(".")) {
        throw new FilmError(where, lineAt(yaml, ["scenes", si, "steps", 0]),
          `each scene starts on a fresh page: begin it with goto (or an adapter step that opens one), not ${first}`, scene.id);
      }
    });
    chapters.push({ key: ck, path, file: value, mtimeMs: yaml.mtimeMs });
  }
  for (const ch of chapters) {
    for (const scene of ch.file.scenes) {
      for (const need of scene.needs) {
        if (!seen.has(need)) throw new FilmError(rel(studio, ch.path), 1, `needs: no scene "${need}" in the mission`, scene.id);
      }
    }
  }
  const translations: Mission["translations"] = {};
  const td = join(dir, "translations");
  if (existsSync(td)) {
    for (const f of (await readdir(td)).filter((f) => f.endsWith(".yaml"))) {
      translations[f.slice(0, -5)] = (await parseFile(TranslationFile, join(td, f), studio)).value;
    }
  }
  return { key, dir, project, file, mtimeMs: myaml.mtimeMs, chapters, translations };
}

/** Every scene of a mission in order, with its chapter. */
export function missionScenes(mission: Mission) {
  return mission.chapters.flatMap((chapter) => chapter.file.scenes.map((scene) => ({ chapter, scene })));
}
