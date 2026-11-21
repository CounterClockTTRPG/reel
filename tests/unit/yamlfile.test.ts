import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readYamlDoc, writeYamlPreserving } from "../../src/util/yamlfile.js";
import { tmp } from "../helpers/tmp.js";

describe("writing YAML", () => {
  it("keeps comments", async () => {
    const file = join(tmp(), "a.yaml");
    writeFileSync(file, "# keep me\nname: A\n");
    await writeYamlPreserving(file, (doc) => doc.set("name", "B"));
    expect(readFileSync(file, "utf8")).toBe("# keep me\nname: B\n");
  });

  it("refuses a write when the file changed since it was read", async () => {
    const file = join(tmp(), "a.yaml");
    writeFileSync(file, "name: A\n");
    const { mtimeMs } = await readYamlDoc(file);
    writeFileSync(file, "name: C\n");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const err = await writeYamlPreserving(file, (doc) => doc.set("name", "B"), mtimeMs).catch((e) => e);
    expect(err.details?.conflict).toBe(true);
    expect(err.message).toMatch(/changed on disk since you opened it/);
    expect(readFileSync(file, "utf8")).toBe("name: C\n");
  });
});
