import { resolve } from "node:path";
import type { Command } from "commander";
import { loadProject, loadStudio } from "../../model/load.js";
import { studioDir } from "../../paths.js";
import { makeTake } from "../../pipeline/make.js";
import { createMission, createProject, initStudio } from "../../studio/create.js";
import { run } from "../../util/proc.js";
import type { Output } from "../output.js";
import { loadTakeTarget } from "../take-target.js";

export function makeCommands(program: Command, out: () => Output) {
  program
    .command("make <take>")
    .description("check, cut, voice, mix and package a take (project/mission for the latest); says what it would spend first")
    .option("--yes", "spend what the narration estimate says")
    .option("--budget <usd>", "spend without asking when the estimate is at most this", Number)
    .option("--force", "voice a take with flagged or stale scenes")
    .option("--allow-missing", "package even when translations are missing or stale")
    .action(async (target: string, o: { yes?: boolean; budget?: number; force?: boolean; allowMissing?: boolean }) => {
      const { ref, project, mission } = await loadTakeTarget(target);
      const o2 = out();
      const result = await makeTake(ref, project, mission, { ...o, log: o2.log });
      o2.result({ take: `${ref.project}/${ref.mission}/${ref.n}`, ...result }, `Made ${ref.project}/${ref.mission}/${ref.n}: ${ref.dir}/package`);
    });

  const create = program.command("new").description("a new project or mission in the studio");
  create
    .command("project <key>")
    .option("--name <name>", "the project's name")
    .option("--adapter <spec>", "an adapter plugin: a path (relative to the project's folder) or a package name")
    .requiredOption("--base <url>", "the application's address")
    .action(async (key: string, o: { name?: string; adapter?: string; base: string }) => {
      const project = await createProject(await loadStudio(), key, o);
      out().result({ project: key, dir: project.dir }, `Project ${key}: ${project.dir}/project.yaml`);
    });
  create
    .command("mission <target>")
    .description("project/mission")
    .option("--title <title>", "the film's title")
    .action(async (target: string, o: { title?: string }) => {
      const [p, m] = target.split("/");
      const project = await loadProject(await loadStudio(), p);
      const mission = await createMission(project, m, { title: o.title ?? m });
      out().result({ mission: target, dir: mission.dir }, `Mission ${target}: ${mission.dir}`);
    });

  program
    .command("init [dir]")
    .description("a new studio (default REEL_STUDIO or ~/reel-studio), as a git repository")
    .action(async (dir?: string) => {
      const target = dir ? resolve(dir) : studioDir();
      initStudio(target);
      await run("git", ["init", "-q"], { cwd: target }).catch(() => {});
      out().result({ studio: target }, `Studio: ${target}${dir ? ` (set REEL_STUDIO=${target} to use it)` : ""}`);
    });
}
