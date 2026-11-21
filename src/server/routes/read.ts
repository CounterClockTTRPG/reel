// Reading the studio for the web UI: projects, missions (with their files as text, so a broken file can still be
// fixed in the editor), takes with their frames and checks.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import { loadAdapter } from "../../adapter/load.js";
import { sourceLines, translationStatus } from "../../i18n/translations.js";
import { voiceNamed } from "../../library/voices.js";
import { FilmError, loadMission, loadProject, loadStudio, type Mission, type Project } from "../../model/load.js";
import { effectiveStyle } from "../../model/style.js";
import { vaultDir } from "../../paths.js";
import { cacheFile } from "../../sound/tts.js";
import { estimate } from "../../sound/voice.js";
import { listTakes, readReview, readTake, staleScenes, takeRef, takeSceneFiles, type TakeRef } from "../../take/take.js";
import type { ServerContext } from "../app.js";

export async function project(ctx: ServerContext, key: string): Promise<Project> {
  return loadProject(await loadStudio(ctx.studioDir), key);
}

export async function mission(ctx: ServerContext, p: string, m: string): Promise<Mission> {
  return loadMission(await project(ctx, p), m);
}

async function adapterInfo(p: Project) {
  try {
    const a = await loadAdapter(p.file.adapter, p.dir);
    return a && { name: a.name, version: a.version, steps: Object.entries(a.steps).map(([name, d]) => ({ name: `${a.name}.${name}`, costs: Boolean(d.costs), changes: Boolean(d.changes) })) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const readText = (file: string) => ({ yaml: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs });

/** The URL of a file in a take's folder. */
export function takeUrl(ref: TakeRef, file: string): string {
  return `/files/takes/${relative(join(vaultDir(), "takes"), join(ref.dir, file)).replaceAll("\\", "/")}`;
}

export async function readRoutes(app: FastifyInstance, ctx: ServerContext) {
  app.get("/api/studio", async () => {
    const studio = await loadStudio(ctx.studioDir);
    const projects = [];
    for (const p of studio.projects) {
      const pr = await loadProject(studio, p.key);
      const missions = [];
      for (const m of p.missions) {
        let title = m;
        let error: string | undefined;
        try {
          title = (await loadMission(pr, m)).file.title;
        } catch (e) {
          error = (e as Error).message;
        }
        const takes = await listTakes(p.key, m);
        missions.push({ key: m, title, error, takes: takes.length, latest: takes.at(-1) ?? null });
      }
      projects.push({ key: p.key, name: p.name, base: pr.file.app.base, missions });
    }
    return { dir: studio.dir, projects };
  });

  app.get<{ Params: { p: string } }>("/api/projects/:p", async (req) => {
    const pr = await project(ctx, req.params.p);
    const { style, sources } = effectiveStyle(pr);
    return { key: pr.key, file: pr.file, style, sources, adapter: await adapterInfo(pr), ...readText(join(pr.dir, "project.yaml")) };
  });

  app.get<{ Params: { p: string; m: string } }>("/api/projects/:p/missions/:m", async (req) => {
    const pr = await project(ctx, req.params.p);
    const dir = join(pr.dir, "missions", req.params.m);
    const missionFile = join(dir, "mission.yaml");
    if (!existsSync(missionFile)) return loadMission(pr, req.params.m); // throws: no such mission (404)
    const chaptersDir = join(dir, "chapters");
    const files = existsSync(chaptersDir) ? readdirSync(chaptersDir).filter((f) => f.endsWith(".yaml")).sort() : [];
    const raw = { mission: readText(missionFile), chapters: files.map((f) => ({ key: f.slice(0, -5), ...readText(join(chaptersDir, f)) })) };
    let m: Mission;
    try {
      m = await loadMission(pr, req.params.m);
    } catch (e) {
      if (!(e instanceof FilmError)) throw e;
      return { key: req.params.m, error: { message: e.message, file: e.file, line: e.line, scene: e.scene }, raw };
    }
    const { style, sources } = effectiveStyle(pr, m);
    const adapter = await adapterInfo(pr);
    const version = (adapter && "version" in adapter ? adapter.version : "") ?? "";
    const source = sourceLines(m);
    const translations = Object.fromEntries(style.languages.slice(1).map((lang) => {
      const s = translationStatus(m, lang);
      return [lang, { ...s, source, lines: m.translations[lang]?.lines ?? {} }];
    }));
    let cost = null;
    try {
      const voice = await voiceNamed(pr.studio, style.voice);
      const provider = process.env.REEL_TTS === "fake" ? "fake" : voice.provider;
      cost = estimate(Object.entries(source).map(([key, text]) => ({ key, text, t: 0 })), voice, (t) => existsSync(cacheFile(voice, t, provider)));
    } catch {}
    const takes = (await listTakes(pr.key, m.key)).map((t) => ({ ...t, stale: staleScenes(m, takeRef(pr.key, m.key, t.n), version) }));
    return {
      key: m.key,
      file: m.file,
      mtimeMs: m.mtimeMs,
      style,
      sources,
      raw,
      chapters: m.chapters.map((c) => ({
        key: c.key,
        title: c.file.title,
        mtimeMs: c.mtimeMs,
        yaml: readFileSync(c.path, "utf8"),
        scenes: c.file.scenes.map((s) => ({ id: s.id, title: s.title, steps: s.steps.length, needs: s.needs, music: s.music })),
      })),
      translations,
      takes,
      estimate: cost,
      adapter,
    };
  });

  app.get<{ Params: { p: string; m: string; n: string } }>("/api/takes/:p/:m/:n", async (req) => {
    const m = await mission(ctx, req.params.p, req.params.m);
    const ref = takeRef(req.params.p, req.params.m, Number(req.params.n));
    const take = readTake(ref);
    const adapter = await adapterInfo(m.project);
    const stale = staleScenes(m, ref, (adapter && "version" in adapter ? adapter.version : "") ?? "");
    const defs = new Map(m.chapters.flatMap((c) => c.file.scenes.map((s) => [s.id, { ...s, chapter: c.file.title }])));
    const scenes = takeSceneFiles(take);
    const json = (file: string) => (existsSync(join(ref.dir, file)) ? JSON.parse(readFileSync(join(ref.dir, file), "utf8")) : null);
    const privacy = json("checks/privacy.json");
    if (privacy) for (const hit of privacy.hits) hit.url = takeUrl(ref, relative(ref.dir, hit.frame));
    const has = (file: string) => existsSync(join(ref.dir, file));
    const pkgDir = join(ref.dir, "package");
    return {
      take,
      review: readReview(ref),
      stale,
      scenes: scenes.map((s) => ({ id: s.id, chapter: defs.get(s.id)?.chapter ?? s.chapter, title: defs.get(s.id)?.title, recording: s.recording, duration: s.duration, needs: defs.get(s.id)?.needs ?? [], exists: defs.has(s.id) })),
      captions: scenes.flatMap((s) => s.events.filter((e) => e.kind === "say").map((e) => ({
        scene: s.id,
        n: e.n,
        t: e.t,
        label: e.label ?? "",
        caption: e.note ?? "",
        spoken: e.spoken ?? e.note ?? "",
        frame: has(`frames/${s.id}-${e.n}.png`) ? takeUrl(ref, `frames/${s.id}-${e.n}.png`) : null,
      }))),
      privacy,
      loudness: json("checks/loudness.json"),
      video: has("mix.mp4") ? takeUrl(ref, "mix.mp4") : has("cut.mp4") ? takeUrl(ref, "cut.mp4") : null,
      chaptersVtt: has("chapters.vtt") ? takeUrl(ref, "chapters.vtt") : null,
      package: existsSync(pkgDir)
        ? {
            files: readdirSync(pkgDir).map((f) => ({ name: f, url: takeUrl(ref, `package/${f}`) })),
            description: has("package/description.md") ? readFileSync(join(pkgDir, "description.md"), "utf8") : "",
            chapters: has("package/chapters.txt") ? readFileSync(join(pkgDir, "chapters.txt"), "utf8") : "",
          }
        : null,
      steps: { checked: Boolean(privacy), cut: has("cut.mp4"), voiced: has("voice/lines.json"), mixed: has("mix.mp4"), packaged: has("package/video.mp4") },
    };
  });
}
