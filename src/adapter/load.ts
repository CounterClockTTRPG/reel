// Loading an adapter named in project.yaml: a path (relative to the project's folder, or absolute, or ~) to a module
// or a folder with a package.json, or an installed package name.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expandHome, ReelError } from "../paths.js";
import type { Adapter } from "./api.js";

function entryOf(path: string): string {
  if (!statSync(path).isDirectory()) return path;
  const pkg = join(path, "package.json");
  if (existsSync(pkg)) {
    const json = JSON.parse(readFileSync(pkg, "utf8"));
    const main = (typeof json.exports === "string" ? json.exports : json.exports?.["."]?.import ?? json.exports?.["."]) ?? json.main;
    if (typeof main === "string") return join(path, main);
  }
  for (const f of ["index.js", "index.mjs", "dist/index.js"]) if (existsSync(join(path, f))) return join(path, f);
  throw new ReelError(1, `adapter folder ${path} has no entry (package.json main, index.js)`);
}

export async function loadAdapter(spec: string | undefined, projectDir: string): Promise<Adapter | null> {
  if (!spec) return null;
  const isPath = /^[.~/\\]/.test(spec) || isAbsolute(spec);
  let url: string;
  if (isPath) {
    const path = resolve(projectDir, expandHome(spec));
    if (!existsSync(path)) throw new ReelError(1, `adapter not found: ${path} (project.yaml adapter)`);
    url = pathToFileURL(entryOf(path)).href;
  } else {
    try {
      url = pathToFileURL(createRequire(join(projectDir, "x.js")).resolve(spec)).href;
    } catch {
      url = spec;
    }
  }
  const mod = await import(url).catch((e) => {
    throw new ReelError(1, `adapter ${spec} failed to load: ${(e as Error).message}`);
  });
  const adapter = (mod.default ?? mod.adapter) as Adapter | undefined;
  if (!adapter?.name || !adapter.steps) throw new ReelError(1, `adapter ${spec} exports no adapter (export default defineAdapter({...}))`);
  for (const name of Object.keys(adapter.steps)) {
    if (name.includes(".")) throw new ReelError(1, `adapter ${adapter.name}: step "${name}" must not contain a dot (Reel adds "${adapter.name}.")`);
  }
  return adapter;
}
