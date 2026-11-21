// A recording session: one browser for the run, and for each scene fresh contexts (the host's and each seat's) that
// record their own video, with the overlay, the privacy masks, the app's localStorage presets and the host's auth.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, request, type APIRequestContext, type Browser, type BrowserContext } from "playwright";
import { parse } from "yaml";
import type { Adapter, TimelineEvent } from "../adapter/api.js";
import type { Project } from "../model/load.js";
import type { Mask, Style } from "../model/schema.js";
import { ReelError, vaultDir } from "../paths.js";
import { overlayScript } from "./overlay.js";
import { Stage } from "./stage.js";

/** The project's API token: REEL_TOKEN_<KEY> or `token` in ~/.reel/secrets/<key>.yaml. */
export function tokenFor(projectKey: string): string | undefined {
  const env = process.env[`REEL_TOKEN_${projectKey.toUpperCase().replaceAll("-", "_")}`];
  if (env) return env;
  const file = join(vaultDir(), "secrets", `${projectKey}.yaml`);
  if (!existsSync(file)) return undefined;
  const token = parse(readFileSync(file, "utf8"))?.token;
  return typeof token === "string" ? token : undefined;
}

export const authFile = (projectKey: string) => join(vaultDir(), "auth", `${projectKey}.json`);

/** The CSS that hides (or blurs) the masked elements. */
export function maskCss(masks: Mask[]): string {
  return masks
    .map((m) => (typeof m === "string" ? { selector: m, blur: false } : m))
    .map((m) => `${m.selector} { ${m.blur ? "filter: blur(12px) !important" : "visibility: hidden !important"} }`)
    .join("\n");
}

export interface SessionOptions {
  project: Project;
  style: Style;
  adapter: Adapter | null;
  overlayCss: string;
  headed?: boolean;
  /** Milliseconds a step waits for its element before it fails (Playwright's action timeout). */
  actionTimeout?: number;
  log?: (msg: string) => void;
}

export interface SceneStage {
  stage: Stage;
  finish(): Promise<{ file: string; seat: string; timeline: TimelineEvent[] }>;
}

export interface Session {
  /** The app's API, with the project's auth: for adapter steps that read or set things without the page. */
  api: APIRequestContext;
  newStage(scene: string, seat: string, outDir: string, size?: { width: number; height: number }): Promise<SceneStage>;
  close(): Promise<void>;
}

export async function openSession(opts: SessionOptions): Promise<Session> {
  const browser: Browser = await chromium.launch({
    headless: !opts.headed,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const { app } = opts.project.file;
  const masks = maskCss([...opts.style.privacy.masks, ...(opts.adapter?.masks ?? [])]);
  const open = new Set<BrowserContext>();

  let auth: { storageState?: string } = {};
  /** The token, sent only to the app's own origin (never to the CDNs and other sites a page loads). */
  let bearer: string | undefined;
  const appOrigin = new URL(app.base).origin;
  if (app.auth === "token") {
    const token = tokenFor(opts.project.key);
    if (!token) throw new ReelError(1, `project ${opts.project.key} records with a token: set REEL_TOKEN_${opts.project.key.toUpperCase().replaceAll("-", "_")} or ~/.reel/secrets/${opts.project.key}.yaml`);
    bearer = `Bearer ${token}`;
  } else if (app.auth === "login") {
    if (!existsSync(authFile(opts.project.key))) throw new ReelError(1, `no saved login for ${opts.project.key}: run \`reel login ${opts.project.key}\``);
    auth = { storageState: authFile(opts.project.key) };
  }

  const api = await request.newContext({
    baseURL: app.base,
    ...(bearer ? { extraHTTPHeaders: { authorization: bearer } } : {}),
    ...(auth.storageState ? { storageState: auth.storageState } : {}),
  });

  return {
    api,
    async newStage(scene, seat, outDir, size = opts.style.size) {
      const context = await browser.newContext({
        baseURL: app.base,
        viewport: size,
        recordVideo: { dir: outDir, size },
        colorScheme: "light",
        permissions: ["microphone"],
        ...(seat === "host" ? auth : {}),
      });
      open.add(context);
      if (bearer && seat === "host") {
        const authorization = bearer;
        await context.route("**/*", (route) => {
          const request = route.request();
          const sameOrigin = (() => {
            try {
              return new URL(request.url()).origin === appOrigin;
            } catch {
              return false;
            }
          })();
          return sameOrigin ? route.continue({ headers: { ...request.headers(), authorization } }) : route.continue();
        });
      }
      context.setDefaultTimeout(opts.actionTimeout ?? 30_000);
      await context.addInitScript(overlayScript(opts.overlayCss));
      await context.addInitScript(
        ({ css, storage }) => {
          try {
            for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
          } catch {}
          // The masks from the very first paint: added as soon as the document has an element, and again should the
          // page's own scripts replace the head.
          const add = () => {
            if (!document.documentElement || document.getElementById("reel-masks")) return;
            const style = document.createElement("style");
            style.id = "reel-masks";
            style.textContent = css;
            (document.head ?? document.documentElement).appendChild(style);
          };
          add();
          new MutationObserver(add).observe(document, { childList: true, subtree: true });
        },
        { css: masks, storage: app.local_storage },
      );
      const page = await context.newPage();
      const stage = new Stage(page, { startedAt: Date.now(), scene, who: seat === "host" ? "" : seat, log: opts.log });
      return {
        stage,
        async finish() {
          const video = page.video();
          await context.close();
          open.delete(context);
          return { file: video ? await video.path() : "", seat, timeline: stage.timeline };
        },
      };
    },
    async close() {
      for (const c of open) await c.close().catch(() => {});
      await api.dispose().catch(() => {});
      await browser.close();
    },
  };
}
