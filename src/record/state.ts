// What one scene leaves for the next (a campaign it made, say): a small JSON bag per mission in the vault. A step's
// `as: key` keeps its result here; a dry run reads the last real run's values.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StateBag as StateBagLike } from "../adapter/api.js";
import { vaultDir } from "../paths.js";

export function stateFile(project: string, mission: string): string {
  return join(vaultDir(), "state", project, `${mission}.json`);
}

export class StateBag implements StateBagLike {
  private values: Record<string, unknown> = {};

  constructor(private file: string) {
    this.load();
  }

  load(): void {
    this.values = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {};
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.values, null, 2));
  }

  get(key: string): unknown {
    return this.values[key];
  }

  has(key: string): boolean {
    return key in this.values;
  }

  set(key: string, value: unknown): void {
    this.values[key] = value;
  }

  snapshot(): Record<string, unknown> {
    return structuredClone(this.values);
  }
}
