// The music library: library/music.yaml, one entry per track under the studio's music root (the owner's own files,
// never in git). `scanMusic` adds new tracks from their tags and marks vanished ones; moods are edited by hand or in
// the web UI and survive a rescan.
import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseFile as readTags } from "music-metadata";
import { Document } from "yaml";
import { parseFile, type Studio } from "../model/load.js";
import { MusicLibrary, type Track } from "../model/schema.js";
import { expandHome, ReelError } from "../paths.js";
import { writeYamlPreserving } from "../util/yamlfile.js";

const AUDIO = /\.(mp3|m4a|aac|ogg|opus|flac|wav)$/i;

export const musicFile = (studio: Studio) => join(studio.dir, "library", "music.yaml");

/** The music root as an absolute path (relative roots are relative to the studio). */
export function musicRoot(studio: Studio): string {
  const root = expandHome(studio.file.music_root);
  return isAbsolute(root) ? root : resolve(studio.dir, root);
}

export function trackPath(studio: Studio, track: Track): string {
  return join(musicRoot(studio), track.file);
}

export async function loadMusic(studio: Studio): Promise<MusicLibrary> {
  if (!existsSync(musicFile(studio))) return { tracks: [] };
  return (await parseFile(MusicLibrary, musicFile(studio), studio.dir)).value;
}

const slugOf = (file: string) =>
  file.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "track";

async function audioFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await audioFiles(root, full)));
    else if (AUDIO.test(entry.name)) out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out.sort();
}

export async function scanMusic(studio: Studio): Promise<{ added: string[]; missing: string[] }> {
  const root = musicRoot(studio);
  if (!existsSync(root)) throw new ReelError(1, `The music root ${root} does not exist (studio.yaml music_root)`);
  const files = await audioFiles(root);
  const lib = await loadMusic(studio);
  const known = new Set(lib.tracks.map((t) => t.file));
  const ids = new Set(lib.tracks.map((t) => t.id));
  const added: Track[] = [];
  for (const file of files.filter((f) => !known.has(f))) {
    const tags = await readTags(join(root, file), { duration: true }).catch(() => null);
    let id = slugOf(file.split("/").pop()!);
    for (let n = 2; ids.has(id); n++) id = `${slugOf(file.split("/").pop()!)}-${n}`;
    ids.add(id);
    added.push({
      id,
      file,
      title: tags?.common.title || file.split("/").pop()!.replace(/\.[^.]+$/, ""),
      artist: tags?.common.artist ?? "",
      ...(tags?.common.album ? { album: tags.common.album } : {}),
      licence: studio.file.default_licence,
      attribution: studio.file.default_attribution,
      moods: [],
      ...(tags?.format.duration ? { length: Math.round(tags.format.duration * 10) / 10 } : {}),
    });
  }
  const present = new Set(files);
  const missing = lib.tracks.filter((t) => !present.has(t.file)).map((t) => t.id);
  const back = lib.tracks.filter((t) => t.missing && present.has(t.file)).map((t) => t.id);
  if (!existsSync(musicFile(studio))) await writeFile(musicFile(studio), new Document({ tracks: [] }).toString());
  await writeYamlPreserving(musicFile(studio), (doc) => {
    lib.tracks.forEach((t, i) => {
      if (missing.includes(t.id)) doc.setIn(["tracks", i, "missing"], true);
      if (back.includes(t.id)) doc.deleteIn(["tracks", i, "missing"]);
    });
    for (const t of added) doc.addIn(["tracks"], doc.createNode(t, { flow: false }));
  });
  return { added: added.map((t) => t.id), missing };
}

export interface PickOptions {
  mood?: string;
  file?: string;
  preferMoods: string[];
  used: Set<string>;
}

/**
 * A track for a scene: by file, or by mood. Tracks the mission hasn't used yet come first, then those sharing the
 * most of the style's moods, then by title.
 */
export function pickTrack(lib: MusicLibrary, opts: PickOptions): Track {
  if (opts.file) {
    const track = lib.tracks.find((t) => t.file === opts.file || t.id === opts.file);
    if (!track) throw new ReelError(1, `no track "${opts.file}" in library/music.yaml`);
    return track;
  }
  const candidates = lib.tracks.filter((t) => !t.missing && t.moods.includes(opts.mood ?? ""));
  if (!candidates.length) throw new ReelError(1, `no track for mood "${opts.mood}" in library/music.yaml`);
  const overlap = (t: Track) => t.moods.filter((m) => opts.preferMoods.includes(m)).length;
  return candidates.sort(
    (a, b) =>
      Number(opts.used.has(a.id)) - Number(opts.used.has(b.id)) || overlap(b) - overlap(a) || a.title.localeCompare(b.title),
  )[0];
}

/** Whether a scene's `music` names a track (by file or id) rather than a mood. */
export function isTrackRef(lib: MusicLibrary, music: string): boolean {
  return lib.tracks.some((t) => t.file === music || t.id === music);
}
