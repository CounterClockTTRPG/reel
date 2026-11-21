// Writing the studio from the web UI: style fields, whole files (missions, chapters, the project), translations,
// reviews, the music library's tags, new projects and missions, voice samples. Every write is checked against the
// file's mtime when it was read (409 when it changed on disk since) and validated before it lands (422 with the line);
// a file that fails validation is left as it was. The web UI writes as the owner.
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { setTranslation } from "../../i18n/translations.js";
import { musicFile, scanMusic } from "../../library/music.js";
import { voiceNamed } from "../../library/voices.js";
import { FilmError, loadMission, loadProject, loadStudio } from "../../model/load.js";
import { MissionFile, MusicLibrary, ProjectFile } from "../../model/schema.js";
import { ReelError } from "../../paths.js";
import { createMission, createProject } from "../../studio/create.js";
import { cacheFile, priceOf, providerFor, speakCached } from "../../sound/tts.js";
import { setSceneReview, setTakeStatus, takeRef } from "../../take/take.js";
import { lineAt, writeTextChecked, writeYamlPreserving, type YamlDoc } from "../../util/yamlfile.js";
import type { ServerContext } from "../app.js";
import { mission, project } from "./read.js";

const SAMPLE = "This is how I sound.";

function validator(schema: z.ZodTypeAny, file: string, studio: string) {
  return (yaml: YamlDoc) => {
    const result = schema.safeParse(yaml.doc.toJS() ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path as (string | number)[];
      throw new FilmError(relative(studio, file).replaceAll("\\", "/"), lineAt(yaml, path), `${path.join(".") || "(top)"}: ${issue.message}`);
    }
  };
}

/** Applies `set` and `unset` (dotted paths under `style`) to a YAML file's document. */
function styleEdit(set: Record<string, unknown> = {}, unset: string[] = []) {
  return (doc: import("yaml").Document) => {
    for (const [path, value] of Object.entries(set)) doc.setIn(["style", ...path.split(".")], doc.createNode(value, { flow: true }));
    for (const path of unset) doc.deleteIn(["style", ...path.split(".")]);
  };
}

/** Writes a whole file, then loads what depends on it; when that fails, the old text (and mtime) come back. */
async function putChecked(file: string, text: string, mtimeMs: number | undefined, check: () => Promise<unknown>): Promise<number> {
  const old = readFileSync(file);
  const oldStat = statSync(file);
  await writeTextChecked(file, text, mtimeMs);
  try {
    await check();
  } catch (e) {
    writeFileSync(file, old);
    utimesSync(file, oldStat.atime, oldStat.mtime);
    throw e;
  }
  return statSync(file).mtimeMs;
}

type Params = { p: string; m: string };

export async function writeRoutes(app: FastifyInstance, ctx: ServerContext) {
  app.patch<{ Params: { p: string }; Body: { set?: Record<string, unknown>; unset?: string[]; mtimeMs?: number } }>(
    "/api/projects/:p/style",
    async (req) => {
      const pr = await project(ctx, req.params.p);
      const file = join(pr.dir, "project.yaml");
      const mtimeMs = await writeYamlPreserving(file, styleEdit(req.body.set, req.body.unset), req.body.mtimeMs, validator(ProjectFile, file, ctx.studioDir));
      return { mtimeMs };
    },
  );

  app.patch<{ Params: Params; Body: { set?: Record<string, unknown>; unset?: string[]; mtimeMs?: number } }>(
    "/api/projects/:p/missions/:m/style",
    async (req) => {
      const pr = await project(ctx, req.params.p);
      const file = join(pr.dir, "missions", req.params.m, "mission.yaml");
      if (!existsSync(file)) throw new ReelError(2, `No mission ${req.params.p}/${req.params.m}`);
      const mtimeMs = await writeYamlPreserving(file, styleEdit(req.body.set, req.body.unset), req.body.mtimeMs, validator(MissionFile, file, ctx.studioDir));
      return { mtimeMs };
    },
  );

  app.put<{ Params: { p: string }; Body: { yaml: string; mtimeMs?: number } }>("/api/projects/:p/file", async (req) => {
    const pr = await project(ctx, req.params.p);
    const mtimeMs = await putChecked(join(pr.dir, "project.yaml"), req.body.yaml, req.body.mtimeMs, async () => loadProject(await loadStudio(ctx.studioDir), req.params.p));
    return { mtimeMs };
  });

  app.put<{ Params: Params; Body: { yaml: string; mtimeMs?: number } }>("/api/projects/:p/missions/:m/file", async (req) => {
    const pr = await project(ctx, req.params.p);
    const file = join(pr.dir, "missions", req.params.m, "mission.yaml");
    if (!existsSync(file)) throw new ReelError(2, `No mission ${req.params.p}/${req.params.m}`);
    return { mtimeMs: await putChecked(file, req.body.yaml, req.body.mtimeMs, () => loadMission(pr, req.params.m)) };
  });

  app.put<{ Params: Params & { c: string }; Body: { yaml: string; mtimeMs?: number } }>(
    "/api/projects/:p/missions/:m/chapters/:c",
    async (req) => {
      const pr = await project(ctx, req.params.p);
      const file = join(pr.dir, "missions", req.params.m, "chapters", `${req.params.c}.yaml`);
      if (!existsSync(file)) throw new ReelError(2, `No chapter ${req.params.c} in ${req.params.p}/${req.params.m}`);
      return { mtimeMs: await putChecked(file, req.body.yaml, req.body.mtimeMs, () => loadMission(pr, req.params.m)) };
    },
  );

  app.put<{ Params: Params & { lang: string }; Body: { key: string; text: string; mtimeMs?: number } }>(
    "/api/projects/:p/missions/:m/translations/:lang",
    async (req) => {
      const m = await mission(ctx, req.params.p, req.params.m);
      try {
        return { mtimeMs: await setTranslation(m, req.params.lang, req.body.key, req.body.text, req.body.mtimeMs) };
      } catch (e) {
        if (e instanceof ReelError) throw e;
        throw new ReelError(2, (e as Error).message);
      }
    },
  );

  app.post<{ Params: Params & { n: string }; Body: { scene: string; state: "approved" | "flagged" | null; note?: string } }>(
    "/api/takes/:p/:m/:n/review",
    async (req) => setSceneReview(takeRef(req.params.p, req.params.m, Number(req.params.n)), req.body.scene, req.body.state, req.body.note, "owner"),
  );

  app.post<{ Params: Params & { n: string }; Body: { status: "draft" | "approved" | "published" } }>(
    "/api/takes/:p/:m/:n/status",
    async (req) => {
      if (!["draft", "approved", "published"].includes(req.body.status)) throw new ReelError(2, "status is draft, approved or published");
      return setTakeStatus(takeRef(req.params.p, req.params.m, Number(req.params.n)), req.body.status);
    },
  );

  app.patch<{ Params: { id: string }; Body: { moods?: string[]; licence?: string; attribution?: string; title?: string; artist?: string } }>(
    "/api/library/music/:id",
    async (req) => {
      const studio = await loadStudio(ctx.studioDir);
      const file = musicFile(studio);
      await writeYamlPreserving(file, (doc) => {
        const tracks = (doc.toJS() as { tracks: { id: string }[] }).tracks ?? [];
        const i = tracks.findIndex((t) => t.id === req.params.id);
        if (i < 0) throw new ReelError(2, `No track "${req.params.id}"`);
        for (const key of ["moods", "licence", "attribution", "title", "artist"] as const) {
          if (req.body[key] !== undefined) doc.setIn(["tracks", i, key], doc.createNode(req.body[key], { flow: true }));
        }
      }, undefined, validator(MusicLibrary, file, ctx.studioDir));
      return { ok: true };
    },
  );

  app.post("/api/library/music/scan", async () => scanMusic(await loadStudio(ctx.studioDir)));

  app.post<{ Body: { key: string; name?: string; base: string; adapter?: string } }>("/api/projects", async (req, reply) => {
    const pr = await createProject(await loadStudio(ctx.studioDir), req.body.key, req.body);
    return reply.code(201).send({ key: pr.key });
  });

  app.post<{ Params: { p: string }; Body: { key: string; title?: string } }>("/api/projects/:p/missions", async (req, reply) => {
    const m = await createMission(await project(ctx, req.params.p), req.body.key, { title: req.body.title ?? req.body.key });
    return reply.code(201).send({ key: m.key });
  });

  app.post<{ Params: { name: string }; Body: { yes?: boolean } }>("/api/library/voices/:name/sample", async (req) => {
    const studio = await loadStudio(ctx.studioDir);
    const voice = await voiceNamed(studio, req.params.name);
    const providerId = process.env.REEL_TTS === "fake" ? "fake" : voice.provider;
    const cached = existsSync(cacheFile(voice, SAMPLE, providerId));
    if (!cached && !req.body?.yes) {
      throw new ReelError(4, `a sample of ${req.params.name} costs $${priceOf(voice, SAMPLE.length).toFixed(4)}`, { estimate: { usd: priceOf(voice, SAMPLE.length), characters: SAMPLE.length } });
    }
    await speakCached(SAMPLE, voice, providerFor(voice), { project: "(library)", mission: "(sample)" });
    return { url: `/api/library/voices/${req.params.name}/sample.mp3` };
  });

  app.get<{ Params: { name: string } }>("/api/library/voices/:name/sample.mp3", async (req, reply) => {
    const voice = await voiceNamed(await loadStudio(ctx.studioDir), req.params.name);
    const file = cacheFile(voice, SAMPLE, process.env.REEL_TTS === "fake" ? "fake" : voice.provider);
    if (!existsSync(file)) throw new ReelError(2, `No sample of ${req.params.name} yet`);
    return reply.sendFile(relative(join(file, ".."), file), join(file, ".."));
  });
}
