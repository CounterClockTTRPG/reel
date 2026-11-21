import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./setup.ts",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://localhost:7791", viewport: { width: 1360, height: 900 } },
  reporter: [["list"]],
});
