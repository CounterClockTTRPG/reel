import { afterEach, describe, expect, it } from "vitest";
import { assertSlug, ReelError, takeDir } from "../../src/paths.js";
import { tmp } from "../helpers/tmp.js";

describe("paths", () => {
  const before = process.env.REEL_DATA;
  afterEach(() => { process.env.REEL_DATA = before; });

  it("rejects a slug with capitals as a usage error", () => {
    try {
      assertSlug("Delve", "project");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReelError);
      expect((e as ReelError).code).toBe(2);
    }
  });

  it("puts takes in the vault", () => {
    process.env.REEL_DATA = tmp();
    expect(takeDir("delve", "srd35", 7).replaceAll("\\", "/")).toMatch(/takes\/delve\/srd35\/7$/);
  });
});
