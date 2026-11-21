// Translations of what the narrator says, for the subtitles of the other languages: translations/<lang>.yaml maps a
// line's key (`opening`, `closing`, `<chapter>/chapter`, `<scene>/<n>`) to its text and a hash of the source line it
// translates. A changed source line makes its translation stale; a line whose scene is gone is orphaned.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sayIndexes, stepAction, type Mission } from "../model/load.js";
import type { Card } from "../model/schema.js";
import { writeYamlPreserving } from "../util/yamlfile.js";

export const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

const cardLine = (card: Card) => card.spoken ?? `${/[.?!]$/.test(card.title) ? card.title : `${card.title}.`} ${card.text ?? ""}`.trim();

/** The narrator's lines of a mission by key, in the order they are spoken. */
export function sourceLines(mission: Mission): Record<string, string> {
  const lines: Record<string, string> = { opening: cardLine(mission.file.opening) };
  for (const chapter of mission.chapters) {
    if (mission.file.interstitials) lines[`${chapter.key}/chapter`] = cardLine({ title: chapter.file.title, text: chapter.file.text });
    for (const scene of chapter.file.scenes) {
      for (const [step, n] of sayIndexes(scene.steps)) {
        const args = stepAction(step).args as string | { text: string; spoken?: string };
        lines[`${scene.id}/${n}`] = typeof args === "string" ? args : (args.spoken ?? args.text);
      }
    }
  }
  if (mission.file.closing) lines.closing = cardLine(mission.file.closing);
  return lines;
}

export interface TranslationStatus {
  ok: Record<string, string>;
  stale: string[];
  missing: string[];
  orphaned: string[];
}

export function translationStatus(mission: Mission, lang: string): TranslationStatus {
  const source = sourceLines(mission);
  const done = mission.translations[lang]?.lines ?? {};
  const status: TranslationStatus = { ok: {}, stale: [], missing: [], orphaned: [] };
  for (const [key, text] of Object.entries(source)) {
    const t = done[key];
    if (!t) status.missing.push(key);
    else if (t.source !== sourceHash(text)) status.stale.push(key);
    else status.ok[key] = t.text;
  }
  // Lines translated for a scene, caption or chapter that is no longer there.
  status.orphaned = Object.keys(done).filter((k) => !(k in source));
  return status;
}

/** Writes one translated line (with the hash of the source line it translates). */
export async function setTranslation(mission: Mission, lang: string, key: string, text: string, expectMtimeMs?: number): Promise<number> {
  const source = sourceLines(mission)[key];
  if (source === undefined) throw new Error(`no line "${key}" in ${mission.project.key}/${mission.key}`);
  const dir = join(mission.dir, "translations");
  const file = join(dir, `${lang}.yaml`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "lines: {}\n");
  }
  return writeYamlPreserving(file, (doc) => {
    if (!doc.has("lines")) doc.set("lines", doc.createNode({}));
    doc.setIn(["lines", key], doc.createNode({ text, source: sourceHash(source) }, { flow: true }));
  }, expectMtimeMs);
}
