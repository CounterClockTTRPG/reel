import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Built into dist/web, which `reel serve` serves; `npm run dev` proxies the API to a running `reel serve`.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../dist/web", import.meta.url)), emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:7779", "/files": "http://127.0.0.1:7779" } },
});
