import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server/app.js";
import { recordedTake, type Recorded } from "../helpers/recorded.js";

let app: FastifyInstance;
let r: Recorded;
const call = async (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) => {
  const res = await app.inject({ method, url, payload, headers: { host: "localhost" } });
  return { status: res.statusCode, body: res.json() };
};
const project = () => readFileSync(join(r.studio, "projects/demo/project.yaml"), "utf8");

beforeAll(async () => {
  r = await recordedTake();
  app = await buildServer({ studioDir: r.studio });
}, 300_000);
afterAll(() => app?.close());

describe("the write API", () => {
  it("changes the project's style and keeps the file's comments", async () => {
    const { body: before } = await call("GET", "/api/projects/demo");
    const res = await call("PATCH", "/api/projects/demo/style", { set: { "music.loudness": -30 }, mtimeMs: before.mtimeMs });
    expect(res.status).toBe(200);
    expect(project()).toContain("loudness: -30");
    expect(project()).toContain("# A demo project against the fixture app.");
  });

  it("refuses a change to a file that changed on disk since it was read", async () => {
    const { body: before } = await call("GET", "/api/projects/demo");
    utimesSync(join(r.studio, "projects/demo/project.yaml"), new Date(), new Date(Date.now() + 10_000));
    const res = await call("PATCH", "/api/projects/demo/style", { set: { "music.loudness": -31 }, mtimeMs: before.mtimeMs });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/changed on disk since you opened it/);
  });

  it("refuses a style the schema doesn't allow, leaving the file as it was", async () => {
    const text = project();
    const { body } = await call("GET", "/api/projects/demo");
    const res = await call("PATCH", "/api/projects/demo/style", { set: { "music.loudness": "loud" }, mtimeMs: body.mtimeMs });
    expect(res.status).toBe(422);
    expect(project()).toBe(text);
  });

  it("refuses a chapter with an unknown step, with its line", async () => {
    const { body } = await call("GET", "/api/projects/demo/missions/tour");
    const chapter = body.chapters[0];
    const res = await call("PUT", "/api/projects/demo/missions/tour/chapters/01-basics", {
      yaml: chapter.yaml.replace("- goto: /\n      - say: { label: Home", "- goto: /\n      - clik: '#go'\n      - say: { label: Home"),
      mtimeMs: chapter.mtimeMs,
    });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/01-basics\.yaml:\d+ \(scene "intro"\).*unknown step "clik"/);
    expect(readFileSync(join(r.studio, "projects/demo/missions/tour/chapters/01-basics.yaml"), "utf8")).toBe(chapter.yaml);
  });

  it("saves a chapter edit", async () => {
    const { body } = await call("GET", "/api/projects/demo/missions/tour");
    const chapter = body.chapters[0];
    const res = await call("PUT", "/api/projects/demo/missions/tour/chapters/01-basics", {
      yaml: chapter.yaml.replace("This is the home page.", "Here is the home page."),
      mtimeMs: chapter.mtimeMs,
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(r.studio, "projects/demo/missions/tour/chapters/01-basics.yaml"), "utf8")).toContain("Here is the home page.");
  });

  it("writes a translation", async () => {
    const res = await call("PUT", "/api/projects/demo/missions/tour/translations/nl", { key: "search/0", text: "Het antwoord is er." });
    expect(res.status).toBe(200);
    expect(readFileSync(join(r.studio, "projects/demo/missions/tour/translations/nl.yaml"), "utf8")).toContain("Het antwoord is er.");
  });

  it("flags a scene as the owner", async () => {
    const res = await call("POST", "/api/takes/demo/tour/1/review", { scene: "search", state: "flagged", note: "too fast" });
    expect(res.status).toBe(200);
    const review = JSON.parse(readFileSync(join(r.ref.dir, "review.json"), "utf8"));
    expect(review.scenes.search).toMatchObject({ state: "flagged", note: "too fast", by: "owner" });
  });

  it("edits a track's moods", async () => {
    const res = await call("PATCH", "/api/library/music/epic-a", { moods: ["epic", "battle"] });
    expect(res.status).toBe(200);
    const { body } = await call("GET", "/api/library/music");
    expect(body.tracks.find((t: { id: string }) => t.id === "epic-a").moods).toEqual(["epic", "battle"]);
  });

  it("makes a project and a mission", async () => {
    expect((await call("POST", "/api/projects", { key: "guild", name: "Guild", base: "http://localhost:3000" })).status).toBe(201);
    expect((await call("POST", "/api/projects/guild/missions", { key: "first", title: "First" })).status).toBe(201);
    expect((await call("GET", "/api/projects/guild/missions/first")).body.file.title).toBe("First");
  });

  it("asks before buying a voice sample", async () => {
    const res = await call("POST", "/api/library/voices/wise-lady/sample", {});
    expect(res.status).toBe(402);
    expect(res.body.details.estimate.usd).toBeGreaterThan(0);
  });
});

describe("the write API refuses paths outside the studio", () => {
  it("refuses a chapter name that climbs out of the mission", async () => {
    const res = await call("PUT", "/api/projects/demo/missions/tour/chapters/..%2F..%2F..%2F..%2Fstudio", { yaml: "x: 1\n" });
    expect(res.status).toBe(400);
  });

  it("refuses a language that climbs out of the translations", async () => {
    const res = await call("PUT", "/api/projects/demo/missions/tour/translations/..%2F..%2Fevil", { key: "intro/0", text: "x" });
    expect(res.status).toBe(400);
  });

  it("refuses a project or mission key that isn't a slug", async () => {
    expect((await call("GET", "/api/projects/..%2F..%2Fetc")).status).toBe(400);
    expect((await call("GET", "/api/takes/demo/..%2Ftour/1")).status).toBe(400);
  });
});
