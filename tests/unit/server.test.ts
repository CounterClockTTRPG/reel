import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/server/app.js";
import { serveFixtureApp } from "../helpers/serve.js";
import { recordedTake, type Recorded } from "../helpers/recorded.js";

let app: FastifyInstance;
let r: Recorded;
const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url, headers: { host: "localhost:7779" } });
  return { status: res.statusCode, body: res.headers["content-type"]?.includes("json") ? res.json() : res.body };
};

beforeAll(async () => {
  await serveFixtureApp();
  r = await recordedTake();
  app = await buildServer({ studioDir: r.studio });
}, 300_000);
afterAll(() => app?.close());

describe("the read API", () => {
  it("lists the studio's projects and missions with their latest take", async () => {
    const { body } = await get("/api/studio");
    expect(body.projects[0]).toMatchObject({ key: "demo", name: "Demo" });
    expect(body.projects[0].missions[0]).toMatchObject({ key: "tour", title: "Demo: a tour", latest: { n: 1 } });
  });

  it("gives a project's effective style with where each value came from", async () => {
    const { body } = await get("/api/projects/demo");
    expect(body.sources["music.moods"]).toBe("project");
    expect(body.sources["loudness.voice"]).toBe("default");
    expect(body.adapter.name).toBe("demo");
  });

  it("gives a mission's chapters as text, its translations and takes", async () => {
    const { body } = await get("/api/projects/demo/missions/tour");
    expect(body.chapters[0].yaml).toContain("id: intro");
    expect(body.translations.nl.missing).toContain("intro/0");
    expect(body.takes[0].n).toBe(1);
  });

  it("gives a take's captions with their frames", async () => {
    const { body } = await get("/api/takes/demo/tour/1");
    expect(body.captions[0]).toMatchObject({ scene: "intro", n: 0, caption: "This is the home page." });
    expect(body.scenes.map((s: { id: string }) => s.id)).toEqual(["intro", "search", "result"]);
  });

  it("answers 404 for a project that isn't there", async () => {
    expect((await get("/api/projects/nope")).status).toBe(404);
  });

  it("refuses a host it doesn't know", async () => {
    const res = await app.inject({ method: "GET", url: "/api/studio", headers: { host: "evil.example" } });
    expect(res.statusCode).toBe(421);
  });
});

describe("jobs", () => {
  it("runs a dry run and streams its log", async () => {
    const res = await app.inject({ method: "POST", url: "/api/jobs", headers: { host: "localhost" }, payload: { kind: "dry", target: "demo/tour" } });
    const { id } = res.json();
    const second = await app.inject({ method: "POST", url: "/api/jobs", headers: { host: "localhost" }, payload: { kind: "dry", target: "demo/tour" } });
    expect((await get(`/api/jobs/${second.json().id}`)).body.status).toBe("queued");
    const log = await app.inject({ method: "GET", url: `/api/jobs/${id}/log`, headers: { host: "localhost" } });
    expect(log.headers["content-type"]).toContain("text/event-stream");
    expect(log.body).toContain("Scene intro");
    expect(log.body).toContain("event: end");
    expect((await get(`/api/jobs/${id}`)).body.status).toBe("ok");
  }, 300_000);
});
