// `reel serve`: the studio's web UI and its JSON API, over the same code as the CLI. One owner, no accounts; it answers
// only the host names it knows (localhost, and studio.yaml's allowed_hosts), like Tasker.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { JobRunner } from "../jobs/runner.js";
import { FilmError, loadStudio } from "../model/load.js";
import { ReelError, studioDir as defaultStudio, vaultDir } from "../paths.js";
import { jobRoutes } from "./routes/jobs.js";
import { libraryRoutes } from "./routes/library.js";
import { readRoutes } from "./routes/read.js";
import { writeRoutes } from "./routes/write.js";

export const WEB_ROOT = join(import.meta.dirname, "..", "web");

export interface ServerOptions {
  studioDir?: string;
  logger?: boolean;
}

export interface ServerContext {
  studioDir: string;
  jobs: JobRunner;
}

/** The HTTP status for an error: a conflict 409, a mistake in a file 422, a usage error 400/404, money 402. */
export function statusOf(e: unknown): number {
  if (!(e instanceof ReelError)) return (e as { statusCode?: number }).statusCode ?? 500;
  if (e.details?.conflict) return 409;
  if (e instanceof FilmError) return 422;
  if (e.code === 2) return /^No |^no /.test(e.message) ? 404 : 400;
  if (e.code === 4) return 402;
  if (e.code === 3) return 422;
  return 500;
}

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const dir = opts.studioDir ?? defaultStudio();
  const studio = await loadStudio(dir);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const ctx: ServerContext = { studioDir: dir, jobs: new JobRunner(dir) };

  const allowed = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ...studio.file.allowed_hosts]);
  app.addHook("onRequest", async (req, reply) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!allowed.has(host)) return reply.code(421).send({ detail: `unknown host "${host}": add it to allowed_hosts in studio.yaml` });
  });

  app.setErrorHandler((e, _req, reply) => {
    const status = statusOf(e);
    if (status >= 500) app.log.error(e);
    reply.code(status).send({ detail: (e as Error).message, code: e instanceof ReelError ? e.code : undefined, ...(e instanceof ReelError ? { details: e.details } : {}) });
  });

  const takes = join(vaultDir(), "takes");
  mkdirSync(takes, { recursive: true });
  await app.register(fastifyStatic, { root: takes, prefix: "/files/takes/", decorateReply: true, index: false });
  if (existsSync(join(WEB_ROOT, "index.html"))) {
    await app.register(fastifyStatic, { root: WEB_ROOT, prefix: "/", decorateReply: false, wildcard: true, index: "index.html" });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/files/")) {
        return reply.sendFile("index.html", WEB_ROOT);
      }
      reply.code(404).send({ detail: `no route ${req.method} ${req.url}` });
    });
  }

  await app.register(async (api) => {
    await readRoutes(api, ctx);
    await writeRoutes(api, ctx);
    await libraryRoutes(api, ctx);
    await jobRoutes(api, ctx);
  });
  app.addHook("onClose", async () => ctx.jobs.idle());
  return app;
}
