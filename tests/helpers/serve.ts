import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..", "fixtures", "app");
let server: Server | null = null;

/** Serves the fixture app on http://127.0.0.1:4790 (the fixture project's base), once per test process. */
export async function serveFixtureApp(port = 4790): Promise<string> {
  const url = `http://127.0.0.1:${port}`;
  if (server) return url;
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", url).pathname)).replace(/^([/\\])+/, "");
    try {
      const body = await readFile(join(ROOT, path || "index.html"));
      res.writeHead(200, { "content-type": path.endsWith(".js") ? "text/javascript" : "text/html" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? resolve() : reject(e)));
    server!.listen(port, "127.0.0.1", () => resolve());
  });
  server.unref();
  return url;
}
