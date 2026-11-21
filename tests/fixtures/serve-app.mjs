// A tiny app for Reel's app.serve tests: `node serve-app.mjs --port N` (or --exit to fail at once). It writes a token
// into $APP_DATA, answers /health only after half a second, and serves a page.
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--exit")) {
  console.error("serve-app: refusing to start (as asked)");
  process.exit(3);
}
const port = Number(args[args.indexOf("--port") + 1]);
const data = process.env.APP_DATA;
if (data) {
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "token"), "app-token\n");
}
const started = Date.now();
createServer((req, res) => {
  if (req.url === "/health") {
    if (Date.now() - started < 500) return res.writeHead(503).end("starting");
    return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  }
  res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><h1>Served app</h1><p>${req.headers.authorization ?? "no auth"}</p>`);
}).listen(port, "127.0.0.1", () => console.log(`serve-app on ${port}`));
