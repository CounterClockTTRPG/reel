// Jobs from the web UI: start one, list them, follow one's log as server-sent events.
import type { FastifyInstance } from "fastify";
import { JOB_KINDS, type Job, type JobArgs, type JobKind } from "../../jobs/runner.js";
import { ReelError } from "../../paths.js";
import type { ServerContext } from "../app.js";

const brief = ({ log, ...job }: Job) => ({ ...job, lines: log.length, last: log.at(-1) ?? "" });

export async function jobRoutes(app: FastifyInstance, ctx: ServerContext) {
  app.post<{ Body: { kind: JobKind; target: string; args?: JobArgs } }>("/api/jobs", async (req, reply) => {
    const { kind, target, args } = req.body ?? ({} as { kind: JobKind; target: string });
    if (!JOB_KINDS.includes(kind)) throw new ReelError(2, `kind is one of ${JOB_KINDS.join(", ")}`);
    const job = ctx.jobs.start(kind, String(target ?? ""), args ?? {});
    return reply.code(202).send(brief(job));
  });

  app.get("/api/jobs", async () => ctx.jobs.list().map(brief));

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req) => {
    const job = ctx.jobs.get(req.params.id);
    if (!job) throw new ReelError(2, `no job ${req.params.id}`);
    return job;
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/log", (req, reply) => {
    if (!ctx.jobs.get(req.params.id)) {
      reply.code(404).send({ detail: `no job ${req.params.id}` });
      return;
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const stop = ctx.jobs.follow(
      req.params.id,
      (line) => res.write(`data: ${JSON.stringify(line)}\n\n`),
      (job) => {
        res.write(`event: end\ndata: ${JSON.stringify(brief(job))}\n\n`);
        res.end();
      },
    );
    req.raw.on("close", stop);
  });
}
