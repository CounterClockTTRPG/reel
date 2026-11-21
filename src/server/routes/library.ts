// The shared libraries for the web UI (music, voices, effects) and the spend.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { cardNamed, loadEffects, renderCard, transitionNamed, type Effects } from "../../library/effects.js";
import { run } from "../../util/proc.js";
import { vaultDir } from "../../paths.js";

/** A card template drawn with sample words, kept in the vault's previews. */
async function cardPreview(fx: Effects, name: string, title = "The title"): Promise<string> {
  const template = cardNamed(fx, name);
  const dir = join(vaultDir(), "previews");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `card-${name}-${Math.round(statSync(template).mtimeMs)}-${title.replace(/\W+/g, "-")}.png`);
  if (!existsSync(out)) {
    await renderCard(readFileSync(template, "utf8"), { title, text: "A line of text under the title." }, { width: 1280, height: 720 }, out);
  }
  return out;
}
import { loadMusic, musicRoot } from "../../library/music.js";
import { loadVoices } from "../../library/voices.js";
import { loadStudio } from "../../model/load.js";
import { ReelError } from "../../paths.js";
import { readSpend } from "../../sound/tts.js";
import { readTake, takeNumbers, takeRef } from "../../take/take.js";
import type { ServerContext } from "../app.js";

export async function libraryRoutes(app: FastifyInstance, ctx: ServerContext) {
  app.get("/api/library/music", async () => {
    const studio = await loadStudio(ctx.studioDir);
    const lib = await loadMusic(studio);
    // Which missions play each track (in their latest take).
    const usedBy: Record<string, string[]> = {};
    for (const p of studio.projects) {
      for (const m of p.missions) {
        const last = takeNumbers(p.key, m).at(-1);
        if (last === undefined) continue;
        for (const id of new Set(Object.values(readTake(takeRef(p.key, m, last)).music ?? {}))) (usedBy[id] ??= []).push(`${p.key}/${m}`);
      }
    }
    const moods = [...new Set(lib.tracks.flatMap((t) => t.moods))].sort();
    return { root: musicRoot(studio), moods, tracks: lib.tracks.map((t) => ({ ...t, usedBy: usedBy[t.id] ?? [] })) };
  });

  app.get<{ Params: { id: string } }>("/api/library/music/:id/audio", async (req, reply) => {
    const studio = await loadStudio(ctx.studioDir);
    const track = (await loadMusic(studio)).tracks.find((t) => t.id === req.params.id);
    if (!track) throw new ReelError(2, `no track "${req.params.id}"`);
    if (!existsSync(`${musicRoot(studio)}/${track.file}`)) throw new ReelError(2, `no file for track "${track.id}" (${track.file})`);
    return reply.sendFile(track.file, musicRoot(studio));
  });

  app.get("/api/library/voices", async () => (await loadVoices(await loadStudio(ctx.studioDir))).voices);

  app.get("/api/library/effects", async () => {
    const fx = await loadEffects(await loadStudio(ctx.studioDir));
    return { transitions: fx.transitions, cards: Object.keys(fx.cards), overlays: Object.keys(fx.overlays) };
  });

  // Previews, made on request and kept in the vault: a card with sample words, and a 2 s transition between two cards.
  app.get<{ Params: { name: string } }>("/api/library/effects/cards/:name/preview.png", async (req, reply) => {
    const fx = await loadEffects(await loadStudio(ctx.studioDir));
    const file = await cardPreview(fx, req.params.name);
    return reply.sendFile(basename(file), dirname(file));
  });

  app.get<{ Params: { name: string } }>("/api/library/effects/transitions/:name/preview.mp4", async (req, reply) => {
    const fx = await loadEffects(await loadStudio(ctx.studioDir));
    const t = transitionNamed(fx, req.params.name);
    const dir = join(vaultDir(), "previews");
    const out = join(dir, `transition-${req.params.name}-${t.kind}-${t.length}.mp4`);
    if (!existsSync(out)) {
      const first = await cardPreview(fx, Object.keys(fx.cards)[0], "Before");
      const second = await cardPreview(fx, Object.keys(fx.cards)[0], "After");
      const hold = 1;
      await run("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", String(hold + t.length), "-i", first,
        "-loop", "1", "-framerate", "30", "-t", String(hold + t.length), "-i", second, "-filter_complex",
        `[0:v]scale=640:360,setsar=1,format=yuv420p[a];[1:v]scale=640:360,setsar=1,format=yuv420p[b];[a][b]xfade=transition=${t.kind}:duration=${t.length}:offset=${hold}[v]`,
        "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    }
    return reply.sendFile(basename(out), dir);
  });

  app.get("/api/spend", async () => {
    const entries = readSpend();
    const sum = (list: typeof entries) => Math.round(list.reduce((n, e) => n + e.usd, 0) * 10000) / 10000;
    const by = (key: (e: (typeof entries)[number]) => string) => {
      const groups: Record<string, typeof entries> = {};
      for (const e of entries) (groups[key(e)] ??= []).push(e);
      return Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, { usd: sum(list), lines: list.length, characters: list.reduce((n, e) => n + e.characters, 0) }]));
    };
    return { total: sum(entries), lines: entries.length, byProject: by((e) => e.project), byMission: by((e) => `${e.project}/${e.mission}`), recent: entries.slice(-50).reverse() };
  });
}
