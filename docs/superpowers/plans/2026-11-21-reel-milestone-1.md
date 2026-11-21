# Reel milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reel as a generic studio. It manages projects → missions → takes with shared libraries and a project style,
records web apps scene by scene, and cuts, voices, scores, checks, reviews and packages them for YouTube, from the CLI
and from a full web UI.

**Architecture:** One TypeScript package on Node 24. `src/` holds the library code, which the CLI (`src/cli`) and a
Fastify server (`src/server`) both call, so they never disagree. `web/` is a React/Vite UI built into `dist/web` and
served by the server. The studio (`~/reel-studio`, text in git) and the vault (`~/.reel`, recordings, takes, caches,
secrets) are plain files; there is no database. Applications are reached through generic core steps plus optional
adapter plugins loaded from outside the repository.

**Tech Stack:**
- Node 24 and TypeScript (ESM, `tsc` build)
- commander, zod, yaml (the document API, which keeps comments), music-metadata
- Playwright 1.64.1; ffmpeg/ffprobe and tesseract on the PATH
- Fastify 5 with @fastify/static
- React 19, react-router 7, Vite and @uiw/react-codemirror (YAML mode)
- Vitest; @playwright/test for the UI tests

**Spec:** `docs/superpowers/specs/2026-11-21-reel-design.md` (with `docs/requirements.md`). Read both before any task.

## Global Constraints

- Node 24, Playwright, ffmpeg on the PATH. Runs on Linux and Windows: every child process is spawned with an argument
  array (never a shell string), and every path goes through `node:path`.
- Reel knows no application. No Delve names, selectors or steps in `src/` or `web/`. Delve appears only in docs and in
  the example studio of the README.
- No secrets in the repository or the studio. Tokens come from `REEL_TOKEN_<PROJECT>` (upper case) or
  `~/.reel/secrets/<project>.yaml`.
- The owner's music is never committed. `library/music.yaml` holds paths relative to `studio.yaml`'s `music_root`.
- Every TTS call is cached by `sha256(provider|model|voice|text)` and appended to `~/.reel/spend.jsonl`. A run prints
  its estimate first and spends only with `--yes`, or within `--budget <usd>`.
- Exit codes: 0 done, 1 failed, 2 usage, 3 check failed (privacy, loudness, missing translation), 4 would spend without
  `--yes`. Every command takes `--json`.
- The constants carried over from delve-video stay exactly as they are:
  - reading pace: 2.6 words/s, at least 3.5 s
  - wait cut: keep 4 s of the start and 1.2 s of the end, with a 0.5 s crossfade
  - card: 4.5 s; fade: 1 s
  - music crossfade: 2.5 s
  - voice: -16 LUFS; music: -33 LUFS by default
  - check margin: 12 dB
  - gap between spoken lines: 0.3 s
  - TTS: 4 requests at a time; on a 429, retry up to 10 times waiting 6–10 s
- Server port 7779, bound to 127.0.0.1 unless `studio.yaml` sets `host` and `allowed_hosts`.
- Environment: `REEL_STUDIO` (default `~/reel-studio`) and `REEL_DATA` (default `~/.reel`).

## Review Focus

1. **The web UI and the CLI write the same file at once** (the owner edits a scene while Claude edits the YAML).
   Expected: the later write is refused with 409 "changed on disk since you opened it", never a silent overwrite.
   Pinned in Task 3 and Task 18.
2. **Paths with spaces and Windows separators** (`~/music/Alliance B.mp3`, `C:\Users\...`). Expected: every
   ffmpeg/ffprobe/tesseract call works, and the error names the file. Pinned in Task 1.
3. **A TTS run breaks halfway** (throttled, out of credit). Expected: the lines already bought stay cached and logged,
   a rerun pays only for the rest, and the failed line's text appears in the error. Pinned in Task 12.
4. **A scene renamed or removed between takes.** Expected: the new take drops the review entries and translations of
   scene ids that no longer exist and marks the moved translations stale. It never crashes on a dangling id. Pinned in
   Task 9 and Task 14.
5. **A job killed mid-recording leaves its mission lock behind.** Expected: the next run sees a lock whose PID is dead,
   takes it over with a warning, and does not hang. Pinned in Task 8.

---

## File structure

```
package.json, tsconfig.json, vitest.config.ts, .github/workflows/ci.yml, README.md, deploy/reel.service
src/
  paths.ts                 studio/vault paths, take dirs, slug checks
  util/proc.ts             run(cmd, args), probeDuration(file), which(cmd)
  util/yamlfile.ts         readYaml / writeYamlPreserving with mtime guard
  model/schema.ts          Zod schemas of every studio and vault file
  model/load.ts            loadStudio, loadProject, loadMission, errors with file:line
  model/style.ts           effectiveStyle with sources
  library/music.ts         scanMusic, pickTrack
  library/voices.ts        loadVoices
  library/effects.ts       loadEffects, renderCard
  adapter/api.ts           defineAdapter and the types (exported as "reel/adapter")
  adapter/load.ts          loadAdapter
  adapter/core.ts          core steps
  record/overlay.ts        overlayScript(css)
  record/stage.ts          Stage (ported from delve-video), Timeline
  record/steps.ts          runSteps (optional, if, parallel, seats)
  record/session.ts        browser, contexts, auth, masks, local_storage, seats
  record/recorder.ts       recordMission
  record/cache.ts          sceneKey, scene store
  record/state.ts          state bag
  take/take.ts             createTake, readTake, listTakes, review, staleness
  jobs/lock.ts             withMissionLock
  jobs/runner.ts           JobRunner (server)
  check/privacy.ts         checkPrivacy
  edit/cutplan.ts          planCut (pure)
  edit/join.ts             cutTake
  sound/tts.ts             TtsProvider, replicateMinimax, fakeProvider, speakCached, spend log
  sound/voice.ts           voiceLines, voiceTake, estimate
  sound/mix.ts             mixTake, loudnessCheck
  i18n/translations.ts     translationStatus
  pub/package.ts           packageTake
  pipeline/gates.ts        voiceGate
  pipeline/make.ts         makeTake
  cli/main.ts              commander program; cli/commands/*.ts one file per command
  server/app.ts            buildServer; server/routes/*.ts
web/ index.html, vite.config.ts, src/{main.tsx, api.ts, App.tsx, pages/*.tsx, components/*.tsx, styles.css}
tests/ unit/*.test.ts, fixtures/{app/, studio/, adapter/}, e2e/pipeline.test.ts, ui/*.spec.ts
```

---

## Phase A: foundation

### Task 1: Scaffold, paths, process helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (add `dist/`), `.github/workflows/ci.yml`,
  `src/paths.ts`, `src/util/proc.ts`
- Test: `tests/unit/proc.test.ts`, `tests/unit/paths.test.ts`

**Interfaces:**
- Produces:
  - `studioDir(): string`, `vaultDir(): string`
  - `takeDir(project, mission, n: number): string`
  - `sceneDir(project, mission, scene, recordingId): string`
  - `assertSlug(s: string, what: string): void`: `/^[a-z0-9][a-z0-9-]*$/`, otherwise it throws `ReelError(2)`
  - `class ReelError extends Error { code: 1|2|3|4; details? }`, also in `paths.ts`
  - `run(cmd, args, opts?): Promise<{ stdout, stderr }>`: rejects with a `ReelError(1)` that names the command and
    the first file argument
  - `probeDuration(file): Promise<number>`
  - `requireTools(...names): Promise<void>`

- [ ] **Step 1: Write the package files.**
  - `package.json`: `"type": "module"`, `"bin": { "reel": "dist/cli/main.js" }`,
    `"exports": { "./adapter": "./dist/adapter/api.js" }`, `"engines": { "node": ">=24" }`.
  - Scripts: `build` (tsc + vite build web), `test` (vitest run), `test:ui` (playwright test tests/ui),
    `typecheck`, `dev`.
  - CI: Ubuntu, Node 24, apt ffmpeg and tesseract-ocr, `npx playwright install chromium`, then typecheck, test and
    build.
- [ ] **Step 2: Write the failing tests.** `probeDuration` of a 1 s clip made with
  `ffmpeg -f lavfi -i sine=d=1 "tmp/a b.mp3"` (a space in the name) returns 1 ± 0.05. `run("ffmpeg", ["-i",
  "missing file.mp3"])` rejects, and the message contains `missing file.mp3`. `assertSlug("Delve")` throws with code
  2. `takeDir("delve","srd35",7)` ends with `takes/delve/srd35/7` when `REEL_DATA` is set to a tmp dir.
- [ ] **Step 3: Run** `npx vitest run tests/unit` and expect FAIL.
- [ ] **Step 4: Implement** `src/paths.ts` and `src/util/proc.ts` (`spawn` with an args array; no shell).
- [ ] **Step 5: Run** `npm test` and expect PASS. Then run `npm run typecheck` and expect it to be clean.
- [ ] **Step 6: Commit** with message "Scaffold: package, paths, process helpers".

### Task 2: Schemas and loading (FILM-1, FILM-2, STUDIO-1)

**Files:**
- Create: `src/model/schema.ts`, `src/model/load.ts`, `src/util/yamlfile.ts` (read part),
  `tests/fixtures/studio/**` (a studio with project `demo`, mission `tour` with chapters `01-basics`, music.yaml with
  three fake tracks, voices.yaml with `fake` and `wise-lady`, effects with `crossfade`, `fade-black`,
  `crossfade-short`, card `classic`, overlay `classic`)
- Test: `tests/unit/load.test.ts`

**Interfaces:**
- Produces Zod schemas and inferred types: `StudioFile`, `ProjectFile`, `MissionFile`, `ChapterFile`, `Scene`, `Step`
  (a union of core steps plus `{ [adapterStep: string]: unknown }` for names with a dot), `Style`, `MusicLibrary`,
  `Track`, `Voices`, `Transitions`, `TranslationFile`.
  - `Step` common keys: `optional?: boolean`, `if?: string`, `seat?: string`. `parallel: Step[][]` is a step of its
    own.
  - The fields are as in the spec's YAML examples.
- `loadStudio(dir = studioDir()): Promise<Studio>` returns `{ dir, file: StudioFile, projects: ProjectSummary[] }`.
- `loadProject(studio, key): Promise<Project>` returns `{ key, dir, file: ProjectFile }`.
- `loadMission(project, key): Promise<Mission>` returns `{ key, dir, file: MissionFile, chapters: { key, file:
  ChapterFile, path }[], translations: Record<lang, TranslationFile> }`.
- `class FilmError extends ReelError` with `{ file, line, scene? }`. Its message reads
  `projects/demo/missions/tour/chapters/01-basics.yaml:14 (scene "intro"): steps.2: unknown step "clik"`.

- [ ] **Step 1: Write the failing tests.**
  - `loadMission` on the fixture returns 1 chapter, 3 scenes, and scene ids `["intro","search","result"]`.
  - Duplicate scene ids across chapters fail with a FilmError that names both files.
  - An unknown core step `clik` fails with the line number of that step.
  - An adapter step `demo.act` passes schema loading; adapter args are validated later.
  - A `say` with `spoken` keeps both fields.
  - `parallel` holding two step lists parses.
- [ ] **Step 2: Run** `npx vitest run tests/unit/load.test.ts` and expect FAIL.
- [ ] **Step 3: Implement.** Use `yaml.parseDocument`, so you can take a line number from a node's `range` through
  `LineCounter`, and map Zod issue paths to nodes.
- [ ] **Step 4: Run** the tests and expect PASS.
- [ ] **Step 5: Commit** with message "Model: schemas and loading with file:line errors".

### Task 3: Style inheritance and safe writes (STUDIO-2)

**Files:**
- Create: `src/model/style.ts`; Modify: `src/util/yamlfile.ts` (add the writer)
- Test: `tests/unit/style.test.ts`, `tests/unit/yamlfile.test.ts`

**Interfaces:**
- Produces:
  - `effectiveStyle(project: Project, mission?: Mission): { style: Style; sources: Record<string, "project"|"mission"|"default"> }`
    (keys are dotted paths)
  - `DEFAULT_STYLE: Style` (the loudness values from Global Constraints, `size` 1920x1080, `languages: ["en"]`)
  - `readYamlDoc(file): Promise<{ doc: Document; mtimeMs: number }>`
  - `writeYamlPreserving(file, mutate: (doc) => void, expectMtimeMs?: number): Promise<number>`, which returns the new
    mtime and throws `ReelError(1, "changed on disk since you opened it")` (with `details.conflict = true`) when the
    file's mtime differs from `expectMtimeMs`

- [ ] **Step 1: Write the failing tests.**
  - A mission's `style.music.moods: [epic]` replaces the project's `[fantasy, calm]`, and `sources["music.moods"] ===
    "mission"`.
  - The mission leaves `music.loudness` alone, so it stays -33 from the project.
  - A missing `loudness.voice` falls back to -16 with source `"default"`.
  - `writeYamlPreserving` keeps a `# comment` line.
  - With a stale `expectMtimeMs`, it throws with `details.conflict === true` (Review Focus 1).
- [ ] **Step 2: Run** the tests and expect FAIL. **Step 3: Implement** a deep merge where objects merge and arrays
  are replaced. **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** with message "Style inheritance and comment-preserving writes".

### Task 4: Libraries: music, voices, effects (STUDIO-3, STUDIO-4, STUDIO-5)

**Files:**
- Create: `src/library/music.ts`, `src/library/voices.ts`, `src/library/effects.ts`
- Test: `tests/unit/library.test.ts`

**Interfaces:**
- Consumes: the schemas from Task 2, and `writeYamlPreserving`.
- Produces:
  - `scanMusic(studio): Promise<{ added: string[]; missing: string[] }>`
    - Reads every audio file under `music_root` with music-metadata (title, artist, album, duration).
    - Adds new tracks with `licence: studio.file.default_licence`, `attribution: studio.file.default_attribution`
      and `moods: []`.
    - Marks vanished files `missing: true`, never deletes them, and keeps the hand-edited moods.
  - `pickTrack(library, { mood?, file?, preferMoods, used: Set<string> }): Track`
    - By `file`: that track.
    - By `mood`: tracks whose moods include it and aren't missing, ranked by overlap with `preferMoods`, then unused
      before used, then by title. Ties go to the earliest title.
    - No match throws `ReelError(1, 'no track for mood "x"')`.
  - `loadVoices(studio): Voices`
  - `loadEffects(studio): { transitions; cards: Record<name, htmlPath>; overlays: Record<name, cssPath> }`
  - `renderCard(templateHtml, slots: { title; text?; number?; small? }, size, outPng): Promise<void>`
    - Uses a Playwright page: `setContent`, then a screenshot.
    - Slots are filled into `{{title}}`-style placeholders, HTML-escaped.
    - The `classic` template reproduces delve-video's `cardPage` look (join.mjs).

- [ ] **Step 1: Write the failing tests.**
  - `scanMusic` on a tmp music root with two generated mp3 files, one named with a space and tagged
    `title=Alliance B`, adds 2 tracks.
  - Removing one file and rescanning marks it `missing: true`, and the moods edited in between survive.
  - `pickTrack({mood:"calm"})` prefers the unused track.
  - `renderCard` writes a 1920x1080 PNG (check the IHDR width and height).
  - A title containing `<b>` appears escaped, so the `<b>` text shows on the card.
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Add `reel music scan`** to the CLI skeleton:
  - Create `src/cli/main.ts` with commander, a shared `--json` option, and `ReelError` codes mapped to exit codes.
  - Create `src/cli/commands/music.ts`.
- [ ] **Step 6: Commit** with message "Libraries: music scan and pick, voices, effects, cards".

### Task 5: Adapter API, loader, core steps (STUDIO-6, FILM-3)

**Files:**
- Create: `src/adapter/api.ts`, `src/adapter/load.ts`, `src/adapter/core.ts`, `tests/fixtures/adapter/index.js`
  (adapter `demo`: steps `demo.act` (costs: true, changes: true; types into `#q`, clicks `#go`, marks a wait until
  `#answer` is filled; under dry it returns `{ answer: "stub" }`), and `demo.reset` (changes: true))
- Test: `tests/unit/adapter.test.ts`

**Interfaces:**
- Produces, from `reel/adapter`:
```ts
export interface StepContext { stage: Stage; seat(name: string): Stage; state: StateBag; page: Page;
  dry: boolean; scene: string; log(msg: string): void }
export interface StepDef<A> { args: z.ZodType<A>; costs?: boolean; changes?: boolean;
  run(ctx: StepContext, args: A): Promise<unknown>; dry?(ctx: StepContext, args: A): Promise<unknown> }
export interface Adapter { name: string; version: string; steps: Record<string, StepDef<any>>;
  masks?: string[]; privateStrings?: string[]; init?(ctx: { page: Page; state: StateBag }): Promise<void> }
export function defineAdapter(a: Adapter): Adapter
```
- `loadAdapter(spec: string | undefined, projectDir): Promise<Adapter | null>`
  - Expands `~`, resolves a path against the project dir, or treats the spec as a package name, then calls
    `import()`.
  - Checks that every step name is unprefixed (the loader adds `name.`).
- `CORE_STEPS: Record<string, StepDef>`: the core steps in the spec, each calling `Stage` (Task 6).
  - `wait` takes `{ title, until: selector, timeout? }` and marks a start and an end.
  - `css` takes `{ content }`.
  - `mark` takes `{ title, note? }`.
  - `goto`, `navigate` and `click` take a string or `{ target, ... }`.
- `resolveStep(step, adapter): { name; def; args }`: throws a `FilmError` for an unknown step or bad args.

- [ ] **Step 1: Write the failing tests.**
  - Loading the fixture adapter by relative path gives steps `demo.act` and `demo.reset`.
  - `resolveStep({ "demo.act": { text: 5 } })` fails, naming `demo.act`.
  - `resolveStep({ click: "#go" })` resolves to core `click`.
  - An adapter step name containing a dot is rejected at load.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Adapter plugin interface and core steps".

## Phase B: recording

### Task 6: Stage, overlay, timeline (REC-2)

**Files:**
- Create: `src/record/overlay.ts`, `src/record/stage.ts`, `tests/fixtures/app/{index.html,search.html,app.js}` (a
  static app with a search box `#q`, a button `#go` that fills `#answer` after 2 s, a list `ul.rows`, and an element
  `.private` holding `secret@example.com`)
- Test: `tests/unit/stage.test.ts` (runs Chromium; the fixture app is served by a tiny `node:http` static server
  helper in `tests/helpers/serve.ts`)

**Interfaces:**
- Produces:
  - `overlayScript(themeCss: string): string`: delve-video's `OVERLAY_SCRIPT` with its CSS block replaced by the
    theme. Copy the `classic` theme into `tests/fixtures/studio/library/effects/overlays/classic.css` and into
    `reel init`'s template (Task 24), verbatim from `~/claude/delve-video/lib/stage.mjs`.
  - `class Stage`: delve-video's Stage ported to TypeScript with the same methods, constants and behaviour (`say`,
    `unsay`, `card`, `uncard`, `spot`, `goto`, `navigate`, `glide`, `hover`, `click`, `type`, `scroll`, `zoom`,
    `pause`, `mark`, `settled`, `readingTime`).
  - The ported Stage takes locators from strings via `page.locator()`, accepting Playwright's selector syntax.
  - `wait(title, fn)` records `{ t, end }`.
  - Every overlay event appends to the timeline:
    `type TimelineEvent = { t: number; kind: "say"|"unsay"|"card"|"uncard"|"spot"|"click"|"mark"|"wait";
    title: string; note?: string; spoken?: string; label?: string; box?: Box; end?: number; scene: string; n?: number }`
    - `n` is the index of the say within its scene.
  - `stage.timeline: TimelineEvent[]`.

- [ ] **Step 1: Write the failing tests.**
  - `readingTime("one two three")` returns 3.5. `readingTime` of 26 words returns 1.5 + 26/2.6 = 11.5.
  - Recording a page and calling `say("Hello there", { spot: "ul.rows" })` adds a `say` event with `box.width > 0`
    and `n === 0`.
  - `click("#go")` adds a `click` event with the box's centre.
  - `wait("Waiting", () => page.locator("#answer:not(:empty)").waitFor())` records `end - t >= 2`.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Stage and overlay ported from delve-video, with a timeline".

### Task 7: Step runner and session (FILM-3, PRIV-1, REC-3)

**Files:**
- Create: `src/record/steps.ts`, `src/record/session.ts`, `src/record/state.ts`
- Test: `tests/unit/steps.test.ts`

**Interfaces:**
- Consumes: `Stage`, `CORE_STEPS`, `resolveStep`, `Adapter`.
- Produces:
  - `class StateBag`, backed by `~/.reel/state/<project>/<mission>.json`:
    - `get(k)`, `set(k, v)`, `snapshot()`, `load()`, `save()`
    - a step's `as: key` stores its return value
  - `openSession(opts: { project: Project; style: Style; adapter: Adapter|null; headed?: boolean }): Promise<Session>`
    - one browser for the run
  - `session.newStage(scene: string, seat = "host", size?): Promise<{ stage: Stage; finish(): Promise<{ file: string;
    timeline }> }>`
    - opens a fresh context with `recordVideo` and the overlay from the style's theme
    - injects `local_storage` and an init script that hides `style.privacy.masks` plus the adapter's masks with
      `visibility: hidden` (or `filter: blur(12px)` for masks written `{ selector, blur: true }`)
    - sets auth: a Bearer header for `token`, `storageState` from `~/.reel/auth/<project>.json` for `login`, nothing
      for `none`
  - `runSteps(steps: Step[], ctx: RunContext): Promise<void>`
    - `optional` swallows a missing-element timeout and marks `skipped`
    - `if` checks `locator.count() > 0` first
    - `parallel` runs its lists with `Promise.all`
    - `seat:` runs the step on `ctx.seat(name)`
    - under `dry`, a step whose def has `costs` or `changes` runs `def.dry` if it has one, else is skipped and returns
      `state.get(as)` from the last real run
  - `tokenFor(projectKey): string | undefined` reads `REEL_TOKEN_<KEY>`, then `~/.reel/secrets/<key>.yaml` `token`.

- [ ] **Step 1: Write the failing tests** against the fixture app.
  - A `.private` element listed in masks has `visibility === "hidden"` in the recorded page.
  - `optional: true` on `click: "#nope"` does not throw.
  - `if: "#nope"` skips the step.
  - `parallel` with two `type` steps on two seats finishes in less than the sum of the two.
  - With `dry: true`, `demo.act` returns `"stub"` and does not click `#go` (assert `#answer` stays empty).
  - `as: answer` stores it in the state bag.
  - `tokenFor("demo")` prefers the environment over the file.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Step runner: optional, if, parallel, seats, dry; sessions with masks and auth".

### Task 8: Recorder, scene cache, lock, login (REC-1, REC-4, KEEP-1)

**Files:**
- Create: `src/record/cache.ts`, `src/record/recorder.ts`, `src/jobs/lock.ts`, `src/cli/commands/record.ts`,
  `src/cli/commands/login.ts`
- Test: `tests/unit/recorder.test.ts`, `tests/unit/lock.test.ts`

**Interfaces:**
- Produces:
  - `sceneKey(scene: Scene, adapterVersion: string, base: string, size): string`: sha256 of the canonical JSON,
    first 16 hex characters.
  - `recordMission(opts: { project; mission; scenes?: string[]; flagged?: boolean; all?: boolean; dry?: boolean;
    headed?: boolean; log(msg) }): Promise<{ take?: TakeRef; recorded: string[]; reused: string[]; skippedDry:
    string[] }>`. A scene is recorded when any of these holds, and otherwise reused:
    - it is named
    - it was flagged in the latest take
    - `all` is set
    - it has no cached recording with the current `sceneKey`

    What it does:
    - Each scene goes to `sceneDir(...)/<recordingId>/` with `video.webm`, `video.mp4` (`-c:v libx264 -crf 18
      -pix_fmt yuv420p -r 30`), the seats' videos, and `timeline.json` (timeline times relative to the scene video).
    - It runs chapter `setup` before a chapter's first recorded scene and `teardown` after its last, even on failure.
    - It writes a new take (Task 9) unless `dry`.
    - A failure writes `failure.png` and `timeline.json` into the scene dir and throws
      `ReelError(1, 'scene "search", step 3 (click "#go"): <playwright message>', { screenshot })`.
    - In a dry run, a scene whose `needs` reads a state key absent from the state bag is reported in `skippedDry`,
      with a warning.
  - `withMissionLock(project, mission, fn)` uses the lock file `~/.reel/locks/<p>--<m>.lock` holding
    `{ pid, host, started }`:
    - A live PID is refused with `ReelError(1, "mission is being recorded by pid N")`.
    - A dead PID is taken over with a warning (Review Focus 5).
  - CLI:
    - `reel record <project>/<mission> [--scene id...] [--flagged] [--all] [--dry] [--headed]`
    - `reel login <project>`: headed, then saves `storageState` to `~/.reel/auth/<project>.json`

- [ ] **Step 1: Write the failing tests** with the fixture studio and app.
  - The first `recordMission` records all 3 scenes.
  - A second run with `scenes: ["search"]` records 1 and reuses 2, and the take number goes from 1 to 2.
  - Changing a scene's caption text changes its `sceneKey`, and the next plain run records only that scene.
  - A scene with `click: "#missing"` and an `actionTimeout` of 2 s fails, with `failure.png` present and the scene id
    in the message, and the same happens with `dry: true` (KEEP-1).
  - A lock file holding a dead PID (spawn `node -e ""`, wait for it to exit, use its pid) is taken over.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Recorder: scenes recorded separately and cached, dry runs, locks, login".

### Task 9: Takes and review (REC-1, REV-1 data)

**Files:**
- Create: `src/take/take.ts`, `src/cli/commands/takes.ts`
- Test: `tests/unit/take.test.ts`

**Interfaces:**
- Produces:
  - `type TakeJson = { n; project; mission; made: string; by: string; scenes: { id; chapter; recording; key }[];
    files: Record<path, sha256>; music?: Record<sceneId, trackFile> }`
  - `type ReviewJson = { status: "draft"|"approved"|"published"; scenes: Record<id, { state: "approved"|"flagged";
    note?; at; by: "owner"|"claude" }> }`
  - `createTake(mission, scenes, prev?: TakeJson): Promise<TakeRef>`: copies the review entries of scenes whose
    recording is unchanged and drops ids that no longer exist (Review Focus 4)
  - `readTake(ref)`, `listTakes(project, mission): Promise<TakeSummary[]>`
  - `setSceneReview(ref, id, state, note, by)`, `setTakeStatus(ref, status)`
  - `staleScenes(mission, take): string[]`: scenes whose `needs` names a scene whose recording is newer than theirs,
    or whose current `sceneKey` differs from the take's
  - `TakeRef = { project; mission; n; dir }`, parsed from `delve/srd35/7` or `delve/srd35` (the latest) by
    `parseTakeRef(s)`
  - CLI:
    - `reel takes <p>/<m>`: a list with status, flagged count and stale count
    - `reel review <take> --approve <scene> | --flag <scene> --note "..."`

- [ ] **Step 1: Write the failing tests.**
  - A flag on `search` in take 1 is carried into take 2 when `search` wasn't retaken, and dropped when it was.
  - Renaming `result` to `answer` in the chapter, then taking again, yields a review without `result`, and no throw.
  - A retake of `intro`, with `search` that `needs: [intro]`, makes `search` stale.
  - `parseTakeRef("demo/tour")` resolves to the highest n.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Takes: assembly from scenes, review state, staleness".

## Phase C: post

### Task 10: Privacy check (PRIV-2)

**Files:**
- Create: `src/check/privacy.ts`, `src/cli/commands/check.ts`
- Test: `tests/unit/privacy.test.ts`

**Interfaces:**
- Produces `checkPrivacy(take, style, adapter): Promise<{ ok: boolean; hits: { scene; t; frame: string; text: string;
  match: string }[]; frames: number }>`.
  - Frames come from each scene's mp4: one per second, plus one at each `say` event's `t + 1`, made with
    `ffmpeg -ss <t> -frames:v 1` into `take/checks/frames/<scene>-<t>.png`.
  - Each frame is read with `tesseract <png> - --psm 11`.
  - Matching is case-insensitive and ignores whitespace, against `style.privacy.strings` plus
    `adapter.privateStrings`.
  - The result goes to `take/checks/privacy.json`.
  - The CLI `reel check <take>` exits 3 on hits.
  - It also writes `take/frames/<scene>-<n>.png`, the frame per caption the review shows (REV-1).

- [ ] **Step 1: Write the failing test.** Record the fixture mission with the `.private` mask **removed** and
  `privacy.strings: ["secret@example.com"]`. The check finds 1 or more hits in scene `intro`. With the mask on, it
  finds 0 hits. `take/frames/intro-0.png` exists.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Privacy frame check by OCR, frames per caption".

### Task 11: Cut plan and join (EDIT-1, EDIT-2)

**Files:**
- Create: `src/edit/cutplan.ts`, `src/edit/join.ts`, `src/cli/commands/cut.ts`
- Test: `tests/unit/cutplan.test.ts`, `tests/unit/join.test.ts`

**Interfaces:**
- Produces:
  - `planCut(input: { opening; credits; chapters: { title; text; scenes: { id; duration; timeline;
    speed?: number }[] }[]; cutWaits: boolean; interstitials: boolean; transitions; constants }): CutPlan`
    - pure: no I/O
    - `CutPlan = { segments: Segment[]; total; markers: TimelineEvent[] /* on the film's clock */; chapters: { title;
      start; end }[] }`
    - `Segment = { kind: "card"|"scene"; source?; from; length; start; transition: { kind; length } | null; speed?;
      badge? }`
  - Its rules come from delve-video's `join.mjs`:
    - A wait longer than `KEEP_BEFORE + KEEP + 1` is cut, keeping its first 4 s and last 1.2 s with a
      `crossfade-short` (0.5 s) transition.
    - A scene with `speed: 2..4` plays its waits at that speed with a badge `"×N"` instead.
    - Scenes in a chapter crossfade, chapters fade through black, and the opening card and credits are segments.
    - A crossfade overlaps segments by its length.
  - `cutTake(take, opts): Promise<{ file: string /* cut.mp4 */; plan }>`
    - renders the cards with `renderCard` (the credits text comes from the tracks chosen by `chooseMusic`, which this task creates in
      `src/sound/choice.ts`: a scene's `music` field, else the previous scene's choice; written into `take.json`, reused
      when already there)
    - builds one ffmpeg `filter_complex` (trim, scale/fps/setsar normalise, `xfade` for each transition, `setpts` for
      speed with a `drawtext` badge)
    - writes `cut.mp4`, `markers.json`, `chapters.txt` (FFMETADATA) and embeds the chapters

- [ ] **Step 1: Write the failing tests** for `planCut`.
  - A 60 s scene with a wait from 10 to 40 keeps 0–14 and 38.8–60.
  - Its markers after 40 s shift by -24.8.
  - A 5 s wait is not cut.
  - With `speed: 3`, the wait segment length becomes 10 and its badge is "×3".
  - Two chapters give chapter marks whose `start` sits at each chapter's first segment start.
  - The total equals the sum of the lengths minus the overlaps.
- [ ] **Step 2: Write the failing test** for `cutTake` on the fixture take. `cut.mp4`'s duration equals
  `plan.total` ± 0.2. ffprobe reads 1 or more chapters.
- [ ] **Step 3: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 4: Commit** with message "Cut plan and join: waits cut or sped up, cards, transitions, chapters".

### Task 12: TTS with cache, estimate and spend (SOUND-1)

**Files:**
- Create: `src/sound/tts.ts`, `src/sound/voice.ts`, `src/pipeline/gates.ts`, `src/cli/commands/voice.ts`
- Test: `tests/unit/tts.test.ts`, `tests/unit/voice.test.ts`

**Interfaces:**
- Produces:
  - `interface TtsProvider { id: string; speak(text, voice: VoiceDef): Promise<Buffer> }`
  - `replicateMinimax(token, fetchImpl = fetch): TtsProvider`, ported from voiceover.mjs:
    - model `minimax/speech-02-hd`; 429 retried up to 10 times at 6–10 s
    - the token comes from `REPLICATE_API_TOKEN` or `~/.reel/secrets/replicate.yaml`
  - `fakeProvider(): TtsProvider`: a sine tone of length `0.06 s × characters`, for tests and dry use
  - `voiceLines(take, plan: CutPlan, lang): Line[]`
    - `Line = { t; text; key: string /* sceneId/n or opening */ }`
    - the text is `spoken ?? note`; cards give "Title. text"
    - the cut cues (`mark`, `wait`) are left out
  - `estimate(lines, voice): { lines; cached; toBuy; characters; usd }`
  - `voiceTake(take, { yes?, budget?, provider? }): Promise<{ file /* voice/narration.wav */; lines: PlacedLine[]; spent }>`
    - checks the gate first (`voiceGate`)
    - prints the estimate, then throws `ReelError(4)` unless `yes`, or unless `usd <= budget`
    - 4 at a time; each bought line is appended to `spend.jsonl` immediately (Review Focus 3)
    - places each line at `max(t, previousEnd + 0.3)` and warns when a line waits more than 2 s
    - writes `voice/lines.json`
  - `voiceGate(take, { force? }): void` throws `ReelError(3)` when:
    - `privacy.json` is missing or not ok (`force` never lifts this)
    - any scene is flagged, unless `force`
    - `staleScenes` isn't empty, unless `force`

- [ ] **Step 1: Write the failing tests.**
  - A provider that fails on the 3rd of 5 lines: the first two lines are cached and are in `spend.jsonl`, and the
    error message contains the 3rd line's text.
  - A rerun with a working provider buys exactly 3 lines.
  - `estimate` with all cached gives `usd === 0`.
  - Without `yes`, a run that needs to buy throws code 4.
  - `voiceGate` with a flagged scene throws code 3. With `force` it passes. With a failed privacy check plus `force`,
    it still throws.
  - Two overlapping lines are placed 0.3 s apart.
  - The Replicate provider retries on 429 (a mocked fetch returns 429 twice, then succeeds).
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Narration: TTS providers, cache, estimate, spend log, voice gate".

### Task 13: Score, mix and loudness check (SOUND-2, SOUND-3)

**Files:**
- Create: `src/sound/mix.ts`, `src/cli/commands/mix.ts`
- Test: `tests/unit/mix.test.ts`

**Interfaces:**
- Consumes: `pickTrack`, `CutPlan`, `chooseMusic`, `voice/lines.json`.
- Produces:
  - uses `chooseMusic(take, mission, style, library): Record<sceneId, trackFile>` from Task 11
    (`src/sound/choice.ts`)
  - `mixTake(take): Promise<{ file /* mix.mp4 */; loudness: LoudnessReport }>`. The ffmpeg graph is voiceover.mjs's
    SCORES branch:
    - cues start at the first segment of the scene that changes the track
    - each cue is looped with `-stream_loop -1`, then crossfaded for 2.5 s
    - voice `loudnorm=I=<style.loudness.voice>`; music `loudnorm=I=<style.music.loudness>`
    - `sidechaincompress=threshold=0.015:ratio=12:attack=20:release=700`; `alimiter=limit=0.89`
    - the video is copied (`-c:v copy`) and the chapters are kept
  - `loudnessCheck(mixFile, voiceLines, style): Promise<LoudnessReport>`
    - `LoudnessReport = { ok; speechLufs; musicOnlyMaxLufs; margin; stretches: { from; to; lufs }[] }`
    - uses `ebur128` over the speech stretches and over the music-only stretches longer than 2 s
    - `ok = speechLufs - musicOnlyMaxLufs >= style.loudness.check_margin` (12)
    - writes `checks/loudness.json`; the CLI exits 3 when it isn't ok

- [ ] **Step 1: Write the failing tests.**
  - A music track named with a space and generated at -10 LUFS with the fake voice: the mix passes the check
    (margin ≥ 12).
  - With `music.loudness: -18`, the check fails, and `stretches` lists the music-only stretch.
  - A track missing from disk fails with its file path in the message (Review Focus 2).
  - A stretch longer than its track still has music at its end, because the track loops (RMS > -60 dB in the last
    second).
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Score and mix by measurement, loudness check".

### Task 14: Translations and the YouTube package (STUDIO-7, PUB-1)

**Files:**
- Create: `src/i18n/translations.ts`, `src/pub/package.ts`, `src/cli/commands/package.ts`,
  `src/cli/commands/translations.ts`
- Test: `tests/unit/translations.test.ts`, `tests/unit/package.test.ts`

**Interfaces:**
- Produces:
  - `sourceLines(mission): Record<key, text>`: keys `opening`, `<chapter>/chapter`, `<scene>/<n>`
  - `translationStatus(mission, lang): { ok: Record<key, text>; stale: key[]; missing: key[]; orphaned: key[] }`
    - `TranslationFile = { lines: Record<key, { text; source: sha256-of-source-first-12 }> }`
    - `orphaned` holds keys whose scene no longer exists (Review Focus 4)
  - `packageTake(take, { allowMissing?, frame?: number }): Promise<{ dir }>` writes `package/`:
    - `video.mp4`: a copy of `mix.mp4`
    - `<lang>.srt` per style language, timed from the placed voice lines; other languages use their translations
    - `chapters.txt` in YouTube's format: `0:00 Opening` first, then `m:ss Title`
    - `description.md`: the mission title, the opening text, the chapters, and the credits lines of the tracks used
    - `thumbnail.png`: the opening card at 1280x720, or the frame at `--frame`
  - It throws `ReelError(3)` listing the missing and stale keys per language unless `allowMissing`.
  - CLI: `reel translations <p>/<m> --lang nl` prints the status and, with `--json`, the lines to translate. This is
    for Claude sessions.

- [ ] **Step 1: Write the failing tests.**
  - Changing a source caption makes its `nl` line stale.
  - Deleting a scene makes its lines orphaned, with no throw.
  - `chapters.txt` starts with `0:00 ` and its times are increasing.
  - An `en.srt` cue starts at the placed time of the voice line.
  - Packaging with a missing `nl` line exits 3 and names the key.
  - `thumbnail.png` is 1280x720.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Translations and the YouTube package".

### Task 15: `reel make`, `reel new`, `reel init`

**Files:**
- Create: `src/pipeline/make.ts`, `src/cli/commands/{make,new,init}.ts`, `templates/studio/**` (studio.yaml, library
  with voices.yaml (`wise-lady`: replicate, `minimax/speech-02-hd`, `English_Wiselady`, `price_per_1000: <the price
  Replicate lists for the model, checked on replicate.com when the task is done>`), transitions, card `classic`,
  overlay `classic`)
- Test: `tests/unit/make.test.ts`

**Interfaces:**
- Produces:
  - `makeTake(ref, opts: { yes?; budget?; force?; allowMissing?; log }): Promise<{ steps: { name; ok; ms }[] }>`
    - runs check, cut, voice, mix and package in order and stops at the first failure with that step's code
    - the voice estimate is printed before any work
  - `reel new project <key> [--adapter <spec>] [--base <url>]`
  - `reel new mission <project>/<key> [--title]`: writes the skeleton files, validated
  - `reel init [dir]`: copies `templates/studio`, then `git init`

- [ ] **Step 1: Write the failing tests.**
  - `makeTake` on the fixture with the fake provider and `yes` writes `package/video.mp4`.
  - Without `yes` and with uncached lines, it stops at voice with code 4, after `cut.mp4` was written.
  - `reel new mission demo/second` followed by `loadMission` passes.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "reel make, new, init".

### Task 16: End-to-end pipeline test

**Files:** Create `tests/e2e/pipeline.test.ts`.

- [ ] **Step 1: Write the test.** It runs the real CLI with `execa`-free `run("node", ["dist/cli/main.js", ...])`
  against a tmp copy of the fixture studio, `REEL_DATA` set to a tmp dir, the fixture app, and
  `REEL_TTS=fake`. Add `REEL_TTS=fake` support to the provider factory in Task 12's file.
  1. `record demo/tour --dry` exits 0.
  2. `record demo/tour` exits 0.
  3. `check` exits 0.
  4. `make demo/tour --yes` exits 0.
  5. `package/` holds `video.mp4`, `en.srt`, `nl.srt`, `chapters.txt`, `description.md` and `thumbnail.png`.
  6. `takes demo/tour --json` shows take 1.
  7. `record demo/tour --scene search`, then `takes`, shows take 2 reusing 2 scenes.
- [ ] **Step 2: Run** `npm run build && npx vitest run tests/e2e` and expect PASS within 3 minutes.
- [ ] **Step 3: Commit** with message "End-to-end pipeline test".

## Phase D: server and web UI

### Task 17: Server, read API, jobs (WEB-1)

**Files:**
- Create: `src/server/app.ts`, `src/server/routes/{studio,projects,missions,takes,library,spend,jobs}.ts`,
  `src/jobs/runner.ts`, `src/cli/commands/serve.ts`, `deploy/reel.service`
- Test: `tests/unit/server.test.ts` (Fastify `inject`)

**Interfaces:**
- Produces `buildServer({ studioDir, vaultDir }): FastifyInstance`, with this JSON API. Each read returns the file's
  `mtimeMs` for the writes in Task 18.
  - `GET /api/studio`: projects with their missions and the latest take summary
  - `GET /api/projects/:p`: the file and the effective style with sources
  - `GET /api/projects/:p/missions/:m`: the mission, chapters (raw YAML text and parsed), translations status per
    language, takes, and the estimate of the next make
  - `GET /api/takes/:p/:m/:n`: take.json, review.json, stale scenes, the frames per caption
    (`{ scene; n; label; caption; spoken; frame: url }`), the privacy and loudness reports, the package files
  - `GET /files/takes/:p/:m/:n/*`: static files of the take, with ranges for video
  - `GET /api/library/music|voices|effects`, `GET /api/library/music/:id/audio` (streams the track from
    `music_root`), `GET /api/spend` (totals by project and mission from spend.jsonl)
  - `POST /api/jobs { kind: "record"|"dry"|"check"|"make"|"voice"|"package"; target; args }` returns `{ id }`.
    `GET /api/jobs/:id/log` is SSE. `GET /api/jobs` lists jobs.
- `JobRunner`:
  - It calls the same library functions as the CLI, with a logger that writes to `~/.reel/jobs/<id>.log` and to the
    SSE.
  - Jobs run one at a time per mission (the `withMissionLock` of Task 8).
  - A paid step needs `args.yes`; the UI sends it only after showing the estimate.
- Host checking: requests whose `Host` isn't in `allowed_hosts` (plus localhost and 127.0.0.1) get 421.
- CLI: `reel serve [--port]`.
- `deploy/reel.service`: a systemd user unit like Tasker's. The `Makefile` gets a `service` target that copies
  Tasker's recipe with the name changed.

- [ ] **Step 1: Write the failing tests.**
  - `GET /api/studio` on the fixture lists `demo` with mission `tour`.
  - `GET /api/projects/demo` reports `sources["music.moods"]`.
  - A request with `Host: evil.example` gets 421.
  - `POST /api/jobs {kind:"dry", target:"demo/tour"}` streams a log line containing `intro`, and the job ends with
    `ok`.
  - A second `record` job for the same mission while one runs is queued, not run at the same time.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Server: read API, jobs with streamed logs, host check".

### Task 18: Write API (WEB-1, WEB-2 data)

**Files:** Modify `src/server/routes/*.ts`; Test `tests/unit/server-write.test.ts`.

**Interfaces:**
- Every write takes `{ mtimeMs, ... }` and answers 409 `{ detail: "changed on disk since you opened it" }` on a
  conflict (Review Focus 1). Writes go through the same functions as the CLI, and every write is validated with the
  schemas before saving, so an invalid edit gets 422 with the FilmError message.
  - `PATCH /api/projects/:p/style` takes `{ set: Record<dottedPath, value>, unset: string[] }`; the mission equivalent
    is `PATCH /api/projects/:p/missions/:m/style`.
  - `PUT /api/projects/:p/missions/:m/chapters/:c` takes `{ yaml, mtimeMs }`.
  - `PUT /api/projects/:p/missions/:m/translations/:lang/:key` takes `{ text }`.
  - `POST /api/takes/:p/:m/:n/review` takes `{ scene, state, note }`; `POST .../status` takes `{ status }`.
  - `PATCH /api/library/music/:id` takes `{ moods, licence, attribution }`; `POST /api/library/music/scan`.
  - `POST /api/projects` and `POST /api/projects/:p/missions` (same as `reel new`).
  - `POST /api/library/voices/:name/sample` speaks "This is how I sound." through the cache. The estimate comes
    first: it answers 402 `{ usd }` unless `yes`.

- [ ] **Step 1: Write the failing tests.**
  - Each write lands in the file, and its comments survive.
  - A stale `mtimeMs` gets 409.
  - A chapter PUT with `clik` gets 422 with a line number.
  - A review POST writes `review.json` with `by: "owner"`; the UI is the owner, as in Tasker.
- [ ] **Step 2: Run, then implement, then run.** Expect FAIL, then PASS.
- [ ] **Step 3: Commit** with message "Server: writes with conflict checks and validation".

### Task 19: Web scaffold, Studio and Project screens (WEB-2)

**Files:**
- Create:
  - `web/index.html`, `web/vite.config.ts` (a dev proxy `/api` and `/files` to 7779; build to `dist/web`)
  - `web/src/{main.tsx, App.tsx, api.ts, styles.css}`
  - `web/src/pages/{Studio.tsx, Project.tsx}`
  - `web/src/components/{StyleForm.tsx, SourceBadge.tsx, Layout.tsx}`
- Modify: `src/server/app.ts` (serve `dist/web`, with the SPA fallback)

**Interfaces:**
- Routes: `/` Studio, `/p/:p` Project, `/p/:p/m/:m` Mission, `/p/:p/m/:m/t/:n` Take, `/library/:tab`, `/spend`.
- `api.ts` has typed fetch helpers for every endpoint in Tasks 17–18, and throws `{ status, detail }`.
- Look: Tasker's layout conventions (a sidebar of projects, light and dark via `prefers-color-scheme`).
- `StyleForm`:
  - The fields are voice (a select from the voices library), languages (chips), music moods (chips from the moods the
    library uses), music loudness, overlay/cards/transitions (selects from effects), size, privacy masks and strings
    (list editors).
  - Each field has a `SourceBadge` (project, mission or default) and a "reset to inherited" control on the mission.
  - On a 409, the form shows "Changed on disk: reload".

- [ ] **Step 1: Implement** the scaffold and the two pages.
- [ ] **Step 2: Run** `npm run build && node dist/cli/main.js serve` with `REEL_STUDIO=tests/fixtures/studio`. Then
  `curl -s localhost:7779/ | grep -q '<div id="root">'` exits 0.
- [ ] **Step 3: Commit** with message "Web UI: scaffold, studio and project screens".

### Task 20: Mission screen (WEB-2)

**Files:** Create `web/src/pages/Mission.tsx`, `web/src/components/{ChapterEditor.tsx, Translations.tsx, TakeList.tsx,
JobPanel.tsx, EstimateDialog.tsx}`.

**Interfaces:**
- The tabs are Style (the `StyleForm` in mission mode), Script, Translations and Takes.
- **Script:**
  - One CodeMirror YAML editor per chapter.
  - Save sends `PUT .../chapters/:c` and shows a 422 inline at its line.
  - A scene list beside the editor jumps to a scene.
  - Reorder moves a scene block within the YAML document: an up and a down button that rewrite the chapter through
    `PUT`.
- **Translations:**
  - A table per language of key, source text and translation (editable), with the stale, missing and orphaned rows
    marked.
- **Takes:**
  - The `TakeList` shows number, date, status, flagged, stale and checks.
- **Buttons:** Dry run, Record (all, or the scenes picked, or the flagged ones), Make.
  - Make first shows the `EstimateDialog` (characters, lines to buy, $), then posts the job with `yes`.
  - `JobPanel` streams the SSE log and links the new take when the job ends.

- [ ] **Step 1: Implement.** **Step 2: Verify by hand** against the fixture studio: start a dry run and watch its log
  stream. **Step 3: Commit** with message "Web UI: mission screen".

### Task 21: Take review screen (REV-1, REV-2)

**Files:** Create `web/src/pages/Take.tsx`, `web/src/components/{SceneReview.tsx, ChecksPanel.tsx, PackagePanel.tsx}`.

**Interfaces:**
- Per scene, in order:
  - its frames, one per caption, each with its label, caption and spoken line
  - Approve / Flag buttons, with a note field when flagging; it posts to the review endpoint
  - a "stale" badge, and "retake" (a record job with that scene)
- The finished video (`mix.mp4`, or `cut.mp4` until there is a mix) in a `<video>` with a WebVTT chapters track. Add
  the generated `chapters.vtt` to Task 14's package and to the cut.
- `ChecksPanel`: the privacy hits with their frame thumbnails, and the loudness numbers with the failing stretches.
- `PackagePanel`: the description (copy button), the chapters, the thumbnail, the subtitles per language, and the
  status buttons (approve the take, mark it published).
- A "Retake flagged" button.

- [ ] **Step 1: Implement.** **Step 2: Verify by hand.** **Step 3: Commit** with message "Web UI: take review".

### Task 22: Library and Spend screens (WEB-3, WEB-4)

**Files:** Create `web/src/pages/{Library.tsx, Spend.tsx}`.

**Interfaces:**
- **Music:**
  - A searchable table of title, artist, moods (chips, editable), licence, used by (missions, from takes'
    `music`), missing, and a play button that streams from the audio endpoint.
  - A Rescan button.
- **Voices:**
  - A list, and "hear a sample" (the estimate, then the sample endpoint).
- **Effects:**
  - Transitions, each previewed with a 2 s clip rendered on request between two cards:
    `GET /api/library/effects/transitions/:name/preview.mp4`, cached in the vault. Add this route to Task 17's
    library routes.
  - Card templates, each rendered with sample slots: `GET /api/library/effects/cards/:name/preview.png`.
- **Spend:**
  - The total, the totals by project and mission, and the last 50 calls.

- [ ] **Step 1: Implement.** **Step 2: Verify by hand.** **Step 3: Commit** with message "Web UI: library and spend".

### Task 23: UI tests

**Files:** Create `tests/ui/playwright.config.ts` (starts `node dist/cli/main.js serve` on a tmp copy of the fixture
studio, with a vault already holding one take from the fixture), `tests/ui/studio.spec.ts`, `tests/ui/review.spec.ts`.

- [ ] **Step 1: Write the tests.**
  - The studio page lists `demo / tour`.
  - Changing the project's music loudness to -30 in the Project page writes `-30` to `project.yaml`.
  - Editing `project.yaml` on disk in between, then saving the form, shows "Changed on disk".
  - Flagging `search` with a note writes `review.json` with that note.
  - The take page shows 1 frame per caption, and the video element has a chapters track.
- [ ] **Step 2: Run** `npm run build && npm run test:ui` and expect PASS. **Step 3: Commit** with message "UI tests".

## Phase E: ship

### Task 24: README, templates, push

**Files:** Modify `README.md`, `CLAUDE.md` (the commands, the studio and vault, how a Claude session makes a film); add
`docs/adapters.md` (how to write an adapter, with the fixture adapter as the example).

- [ ] **Step 1: Write the README.** It covers install (`npm ci`, `npx playwright install chromium`, ffmpeg and
  tesseract per OS, with a Windows section), `reel init`, a first mission against any URL, the commands table, the
  exit codes, `reel serve` and the service.
- [ ] **Step 2: Run** `npm run typecheck && npm test && npm run build && npm run test:ui` and expect all to pass.
- [ ] **Step 3: Push.**
  - `git remote add origin https://github.com/CounterClockTTRPG/reel.git`
  - `git push -u origin milestone-1`
  - Open a PR to `main`.
- [ ] **Step 4: Update Tasker.** Comment on each finished REEL item with what was done and how to check it, then move
  it to `in_review`.

## Not in this plan (after it, separate plans)

- **The Delve adapter** (`~/claude/reel-delve`, a separate repository) is ported from delve-video's `lib/delve.mjs`
  onto `reel/adapter`, with its own Tasker project once the owner agrees.
- **Migrating the tour and SRD 3.5** into `~/reel-studio/projects/delve` and recording them against a local Delve. This
  closes milestone 1 and retires delve-video.
- **Milestone 2:** APP-1 (the overlay drawn in post), APP-2 (Godot).
