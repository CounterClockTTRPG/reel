// YAML files as documents: parsed with positions (for errors with line numbers) and written back with their
// comments kept.
import { readFile, stat, writeFile } from "node:fs/promises";
import { Document, LineCounter, parseDocument } from "yaml";
import { ReelError } from "../paths.js";

export interface YamlDoc {
  doc: Document;
  lines: LineCounter;
  mtimeMs: number;
}

export async function readYamlDoc(file: string): Promise<YamlDoc> {
  const text = await readFile(file, "utf8");
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, keepSourceTokens: true });
  return { doc, lines, mtimeMs: (await stat(file)).mtimeMs };
}

/** The 1-based line of the node at `path`, or of its nearest ancestor that exists. */
export function lineAt({ doc, lines }: Pick<YamlDoc, "doc" | "lines">, path: (string | number)[]): number {
  for (let n = path.length; n >= 0; n--) {
    const node = n === 0 ? doc.contents : doc.getIn(path.slice(0, n), true);
    const range = (node as { range?: [number, number, number] } | undefined)?.range;
    if (range) return lines.linePos(range[0]).line;
  }
  return 1;
}

/**
 * Changes a YAML file through its document, so comments and layout stay, and returns the new mtime. With
 * `expectMtimeMs`, refuses (details.conflict) when the file changed on disk after it was read.
 */
export async function writeYamlPreserving(
  file: string,
  mutate: (doc: Document) => void,
  expectMtimeMs?: number,
): Promise<number> {
  const current = await readYamlDoc(file);
  if (expectMtimeMs !== undefined && Math.abs(current.mtimeMs - expectMtimeMs) > 1) {
    throw new ReelError(1, `${file} changed on disk since you opened it`, { conflict: true, mtimeMs: current.mtimeMs });
  }
  mutate(current.doc);
  await writeFile(file, current.doc.toString({ lineWidth: 0 }));
  return (await stat(file)).mtimeMs;
}

/** Writes `text` as the whole file, with the same conflict check. */
export async function writeTextChecked(file: string, text: string, expectMtimeMs?: number): Promise<number> {
  if (expectMtimeMs !== undefined) {
    const now = (await stat(file)).mtimeMs;
    if (Math.abs(now - expectMtimeMs) > 1) {
      throw new ReelError(1, `${file} changed on disk since you opened it`, { conflict: true, mtimeMs: now });
    }
  }
  await writeFile(file, text);
  return (await stat(file)).mtimeMs;
}
