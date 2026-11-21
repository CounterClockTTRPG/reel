// YAML files as documents: parsed with positions (for errors with line numbers) and written back with their
// comments kept.
import { readFile, stat } from "node:fs/promises";
import { Document, LineCounter, parseDocument } from "yaml";

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
