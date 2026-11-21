// Which track plays under which scene: a scene's `music` (a mood, or a track by file or id), else the track of the
// scene before. Chosen once per take and written into take.json, so the take always sounds the same when remixed.
import { isTrackRef, loadMusic, pickTrack } from "../library/music.js";
import { missionScenes, type Mission } from "../model/load.js";
import type { MusicLibrary, Style, Track } from "../model/schema.js";
import { readTake, writeTake, type TakeRef } from "../take/take.js";

export async function chooseMusic(ref: TakeRef, mission: Mission, style: Style, lib?: MusicLibrary): Promise<Record<string, string>> {
  const take = readTake(ref);
  if (take.music) return take.music;
  const library = lib ?? (await loadMusic(mission.project.studio));
  const music: Record<string, string> = {};
  const used = new Set<string>();
  let current: string | undefined;
  for (const { scene } of missionScenes(mission)) {
    if (scene.music) {
      const track = isTrackRef(library, scene.music)
        ? pickTrack(library, { file: scene.music, preferMoods: style.music.moods, used })
        : pickTrack(library, { mood: scene.music, preferMoods: style.music.moods, used });
      current = track.id;
      used.add(track.id);
    }
    if (current) music[scene.id] = current;
  }
  writeTake(ref, { ...take, music });
  return music;
}

/** The tracks a take uses, in the order they first play. */
export function tracksUsed(music: Record<string, string>, lib: MusicLibrary): Track[] {
  const ids = [...new Set(Object.values(music))];
  return ids.map((id) => lib.tracks.find((t) => t.id === id)).filter((t): t is Track => Boolean(t));
}

/** The credits line of a track (a CC BY licence asks for one). */
export function attributionOf(track: Track): string {
  return track.attribution || [track.title, track.artist && `by ${track.artist}`, track.licence && `(${track.licence})`].filter(Boolean).join(" ");
}
