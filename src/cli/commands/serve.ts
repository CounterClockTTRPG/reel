import type { Command } from "commander";
import { loadStudio } from "../../model/load.js";
import { buildServer } from "../../server/app.js";
import type { Output } from "../output.js";

export function serveCommands(program: Command, out: () => Output) {
  program
    .command("serve")
    .description("the studio's web UI (port and host from studio.yaml)")
    .option("--port <port>", "another port", Number)
    .option("--host <host>", "another address to listen on")
    .action(async (o: { port?: number; host?: string }) => {
      const studio = await loadStudio();
      const app = await buildServer({ studioDir: studio.dir, logger: false });
      const port = o.port ?? studio.file.port;
      const host = o.host ?? studio.file.host;
      await app.listen({ port, host });
      out().log(`Reel on http://${host === "0.0.0.0" ? "localhost" : host}:${port} (studio ${studio.dir})`);
      const stop = async () => {
        await app.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {});
    });
}
