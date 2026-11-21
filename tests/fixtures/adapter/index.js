// The fixture adapter for Reel's tests: an application-specific step for the fixture app, the way a real adapter
// (Delve's) adds its own. Written as plain ESM, as an adapter outside Reel's repository would be.
import { z } from "zod";

export default {
  name: "demo",
  version: "1.0.0",
  masks: [".adapter-private"],
  privateStrings: ["adapter-secret"],
  options: z.object({ greeting: z.string().optional() }).strict(),
  // Seeding the fixture app: with the app stopped, write a file into its data; then a saved login.
  async seed(ctx) {
    if (ctx.options.greeting === "fail") throw new Error("the fixture refuses to seed");
    await ctx.stopApp();
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(ctx.data, "seeded-by-fixture"), "yes");
    await ctx.startApp();
    const res = await ctx.api.get("/health");
    ctx.log(`health ${res.status()}`);
    ctx.secrets.set("owner", "pw");
    ctx.saveLogin({ cookies: [], origins: [] });
  },
  async init({ state, seat }) {
    state.set("inits", [...(state.get("inits") ?? []), seat]);
  },
  steps: {
    // Asks the app a question: types it, presses Go, and waits (a marked wait the edit can cut) for the answer.
    act: {
      args: z.object({ text: z.string() }),
      costs: true,
      changes: true,
      async run(ctx, { text }) {
        await ctx.stage.type("#q", text, { delay: 20 });
        await ctx.stage.click("#go", { after: 0.2 });
        await ctx.stage.wait("Waiting for the answer (cut)", () =>
          ctx.page.locator("#answer:not(:empty)").waitFor({ timeout: 10_000 }));
        return ctx.page.locator("#answer").innerText();
      },
      async dry() {
        return "stub";
      },
    },
    reset: {
      args: z.null(),
      changes: true,
      async run(ctx) {
        await ctx.page.evaluate(() => localStorage.clear());
      },
    },
  },
};
