// The server's JSON API, typed for the pages. Errors throw { status, detail }.

export interface ApiError {
  status: number;
  detail: string;
  details?: Record<string, unknown>;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw { status: res.status, detail: data?.detail ?? res.statusText, details: data?.details } satisfies ApiError;
  return data as T;
}

export const isApiError = (e: unknown): e is ApiError => typeof e === "object" && e !== null && "status" in e && "detail" in e;

export type Source = "default" | "project" | "mission";

export interface TakeSummary {
  n: number;
  made: string;
  status: "draft" | "approved" | "published";
  flagged: number;
  approved: number;
  scenes: number;
  stale?: string[];
}

export interface StudioView {
  dir: string;
  projects: { key: string; name: string; base: string; missions: { key: string; title: string; error?: string; takes: number; latest: TakeSummary | null }[] }[];
}

export type Mask = string | { selector: string; blur: boolean };

export interface Style {
  voice: string;
  languages: string[];
  music: { moods: string[]; loudness: number };
  loudness: { voice: number; music_under: number; check_margin: number };
  overlay: string;
  cards: { opening: string; chapter: string; credits: string };
  transitions: { chapter: string; card: string; cut: string };
  size: { width: number; height: number };
  privacy: { masks: Mask[]; strings: string[] };
}

export interface AdapterInfo {
  name?: string;
  version?: string;
  steps?: { name: string; costs: boolean; changes: boolean }[];
  error?: string;
}

export interface ProjectView {
  key: string;
  file: { name: string; adapter?: string; app: { base: string; auth: string } };
  mtimeMs: number;
  yaml: string;
  style: Style;
  sources: Record<string, Source>;
  adapter: AdapterInfo | null;
}

export interface Estimate {
  lines: number;
  cached: number;
  toBuy: number;
  characters: number;
  usd: number;
}

export interface TranslationView {
  ok: Record<string, string>;
  stale: string[];
  missing: string[];
  orphaned: string[];
  source: Record<string, string>;
  lines: Record<string, { text: string; source: string }>;
}

export interface ChapterView {
  key: string;
  title: string;
  mtimeMs: number;
  yaml: string;
  scenes: { id: string; title?: string; steps: number; needs: string[]; music?: string }[];
}

export interface MissionView {
  key: string;
  error?: { message: string; file: string; line: number; scene?: string };
  raw: { mission: { yaml: string; mtimeMs: number }; chapters: { key: string; yaml: string; mtimeMs: number }[] };
  file?: { title: string; chapters: string[]; cut_waits: boolean; interstitials: boolean; opening: { title: string; text?: string } };
  mtimeMs?: number;
  style?: Style;
  sources?: Record<string, Source>;
  chapters?: ChapterView[];
  translations?: Record<string, TranslationView>;
  takes?: TakeSummary[];
  estimate?: Estimate | null;
}

export interface Caption {
  scene: string;
  n: number;
  t: number;
  label: string;
  caption: string;
  spoken: string;
  frame: string | null;
}

export interface SceneReview {
  state: "approved" | "flagged";
  note?: string;
  at: string;
  by: string;
}

export interface TakeView {
  take: { n: number; made: string; by: string; music?: Record<string, string> };
  review: { status: "draft" | "approved" | "published"; scenes: Record<string, SceneReview> };
  stale: string[];
  scenes: { id: string; chapter: string; title?: string; recording: string; duration: number; needs: string[]; exists: boolean }[];
  captions: Caption[];
  privacy: { ok: boolean; frames: number; strings: number; hits: { scene: string; t: number; match: string; text: string; url: string }[] } | null;
  loudness: { ok: boolean; speechLufs: number; musicOnlyMaxLufs: number | null; margin: number | null; required: number; stretches: { from: number; to: number; lufs: number }[] } | null;
  video: string | null;
  chaptersVtt: string | null;
  package: { files: { name: string; url: string }[]; description: string; chapters: string } | null;
  steps: { checked: boolean; cut: boolean; voiced: boolean; mixed: boolean; packaged: boolean };
}

export interface Track {
  id: string;
  file: string;
  title: string;
  artist: string;
  licence: string;
  attribution: string;
  moods: string[];
  length?: number;
  missing?: boolean;
  usedBy: string[];
}

export interface Job {
  id: string;
  kind: string;
  target: string;
  status: "queued" | "running" | "ok" | "failed";
  created: string;
  error?: string;
  code?: number;
  last?: string;
}

export interface SpendView {
  total: number;
  lines: number;
  byProject: Record<string, { usd: number; lines: number; characters: number }>;
  byMission: Record<string, { usd: number; lines: number; characters: number }>;
  recent: { at: string; project: string; mission: string; take?: number; characters: number; usd: number; text: string }[];
}

export const api = {
  studio: () => call<StudioView>("GET", "/api/studio"),
  project: (p: string) => call<ProjectView>("GET", `/api/projects/${p}`),
  mission: (p: string, m: string) => call<MissionView>("GET", `/api/projects/${p}/missions/${m}`),
  take: (p: string, m: string, n: number) => call<TakeView>("GET", `/api/takes/${p}/${m}/${n}`),
  projectStyle: (p: string, body: { set?: Record<string, unknown>; unset?: string[]; mtimeMs?: number }) =>
    call<{ mtimeMs: number }>("PATCH", `/api/projects/${p}/style`, body),
  missionStyle: (p: string, m: string, body: { set?: Record<string, unknown>; unset?: string[]; mtimeMs?: number }) =>
    call<{ mtimeMs: number }>("PATCH", `/api/projects/${p}/missions/${m}/style`, body),
  putProjectFile: (p: string, yaml: string, mtimeMs: number) => call<{ mtimeMs: number }>("PUT", `/api/projects/${p}/file`, { yaml, mtimeMs }),
  putMissionFile: (p: string, m: string, yaml: string, mtimeMs: number) => call<{ mtimeMs: number }>("PUT", `/api/projects/${p}/missions/${m}/file`, { yaml, mtimeMs }),
  putChapter: (p: string, m: string, c: string, yaml: string, mtimeMs: number) =>
    call<{ mtimeMs: number }>("PUT", `/api/projects/${p}/missions/${m}/chapters/${c}`, { yaml, mtimeMs }),
  putTranslation: (p: string, m: string, lang: string, key: string, text: string) =>
    call<{ mtimeMs: number }>("PUT", `/api/projects/${p}/missions/${m}/translations/${lang}`, { key, text }),
  review: (p: string, m: string, n: number, scene: string, state: "approved" | "flagged" | null, note?: string) =>
    call("POST", `/api/takes/${p}/${m}/${n}/review`, { scene, state, note }),
  takeStatus: (p: string, m: string, n: number, status: string) => call("POST", `/api/takes/${p}/${m}/${n}/status`, { status }),
  newProject: (body: { key: string; name?: string; base: string; adapter?: string }) => call<{ key: string }>("POST", "/api/projects", body),
  newMission: (p: string, body: { key: string; title?: string }) => call<{ key: string }>("POST", `/api/projects/${p}/missions`, body),
  music: () => call<{ root: string; moods: string[]; tracks: Track[] }>("GET", "/api/library/music"),
  editTrack: (id: string, body: Partial<Pick<Track, "moods" | "licence" | "attribution" | "title" | "artist">>) => call("PATCH", `/api/library/music/${id}`, body),
  scanMusic: () => call<{ added: string[]; missing: string[] }>("POST", "/api/library/music/scan"),
  voices: () => call<Record<string, { provider: string; model: string; voice: string; language: string; price_per_1000: number }>>("GET", "/api/library/voices"),
  sample: (name: string, yes = false) => call<{ url: string }>("POST", `/api/library/voices/${name}/sample`, { yes }),
  effects: () => call<{ transitions: Record<string, { kind: string; length: number }>; cards: string[]; overlays: string[] }>("GET", "/api/library/effects"),
  spend: () => call<SpendView>("GET", "/api/spend"),
  jobs: () => call<Job[]>("GET", "/api/jobs"),
  startJob: (kind: string, target: string, args: Record<string, unknown> = {}) => call<Job>("POST", "/api/jobs", { kind, target, args }),
};
