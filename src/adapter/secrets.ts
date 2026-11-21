// An adapter's secrets (the seats' passwords, say): kept in the vault, in ~/.reel/secrets/<project>.yaml under
// `adapter:`, mode 0600, beside the project's own `token:`. Never in the studio.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { vaultDir } from "../paths.js";

export interface SecretStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  /** Forgets every secret of the adapter (the project's own token stays). */
  clear(): void;
}

export const secretsFile = (projectKey: string) => join(vaultDir(), "secrets", `${projectKey}.yaml`);

export function secretsFor(projectKey: string): SecretStore {
  const file = secretsFile(projectKey);
  const read = () => parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
  const write = (doc: ReturnType<typeof read>) => {
    mkdirSync(join(vaultDir(), "secrets"), { recursive: true, mode: 0o700 });
    writeFileSync(file, doc.toString(), { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  return {
    get: (key) => {
      const v = read().getIn(["adapter", key]);
      return typeof v === "string" ? v : undefined;
    },
    set(key, value) {
      const doc = read();
      if (!doc.contents) doc.contents = doc.createNode({}) as never;
      doc.setIn(["adapter", key], value);
      write(doc);
    },
    clear() {
      if (!existsSync(file)) return;
      const doc = read();
      doc.deleteIn(["adapter"]);
      write(doc);
    },
    delete(key) {
      const doc = read();
      doc.deleteIn(["adapter", key]);
      write(doc);
    },
  };
}
