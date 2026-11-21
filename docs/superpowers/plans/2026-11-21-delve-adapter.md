# The Delve adapter and app.serve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reel starts and seeds a separate app for a project (`app.serve`, `reel app seed`), and the Delve adapter
(`~/claude/reel-delve`) gives scripts Delve's steps and seeds a separate Delve from the real one, read-only.

**Architecture:**
- Reel gets a generic app runner: `src/app/serve.ts` starts, checks, reuses and stops the app, under a per-project lock,
  with its data in the vault.
- Reel gets adapter extensions: a `seed` hook, `options`, `secrets` and `select`.
- reel-delve is a TypeScript ESM package. It imports Reel's types, and its tests run against Delve's own fake play
  server (a fake `claude`, no money spent).

**Tech Stack:** Reel (Node 24, TypeScript, Playwright 1.64.1, Vitest); Delve's checkout at `DELVE_REPO` (default
`~/claude/refactoring`, run with `uv`).

**Spec:** `docs/superpowers/specs/2026-11-21-delve-adapter-design.md` (and the Reel design it builds on).

## Global Constraints

- Never write to the real Delve: port 7810 and `~/.local/share/delve` are only read, through GET `/api/modules` and
  `export.dscn`, with its token read from its file when it's needed.
- Delve itself is not changed. A missing hook goes to the DEL backlog.
- Reel stays generic: no Delve names in Reel's `src/` or `web/`.
- No secrets in either repository or in the studio. Passwords go in `~/.reel/secrets/<project>.yaml` under `adapter:`.
- The fake play server runs on ports 47900–47999 (never 7810).
- Commits end with the Co-Authored-By line. reel-delve is pushed to `git@github.com:CounterClockTTRPG/reel-delve.git`.

## Review Focus

1. **A port that's already taken by something else** (another app on 7820). Expected: the run fails, naming the port
   and what answered. It never records against the wrong app. Pinned in Task 2.
2. **An app that never becomes ready** (a bad command, a crash at start). Expected: it fails within the timeout with
   the last lines of serve.log. Pinned in Task 2.
3. **Seeding a second time.** Expected: modules already imported are skipped, and the owner exists already, so it logs
   in with the kept password. Pinned in Task 7.
4. **Seat passwords that no longer log in** (after `--fresh`). Expected: the account is made again. Pinned in Task 6.
5. **A module title missing from the real Delve.** Expected: seeding fails, naming the title and listing the close
   matches. Pinned in Task 7.

---

## Reel

### Task 1: The `select` step, init on every seat, adapter options and secrets

**Files:**
- Modify: `src/model/schema.ts`, `src/adapter/core.ts`, `src/adapter/api.ts`, `src/record/stage.ts`,
  `src/record/steps.ts`, `src/record/recorder.ts`
- Create: `src/adapter/secrets.ts`
- Test: `tests/unit/adapter-ext.test.ts`

**Interfaces:**
- `select: { target, value? , label? }`. Exactly one of value or label is given. `Stage.select(target, { value?, label? })`
  hovers the target, then calls `selectOption` and pauses 1 s.
- `SecretStore { get(key): string | undefined; set(key, value): void }`, with `secretsFor(projectKey): SecretStore`.
  It reads and writes `~/.reel/secrets/<project>.yaml` under `adapter:` with mode 0600, and leaves `token:` alone.
- `StepContext.secrets`, `StepContext.options` (project.yaml's `adapter_options`, checked against `Adapter.options?:
  ZodType`) and `Adapter.init?({ page, state, seat })`, which is called for every seat.
- `ProjectFile.adapter_options?: Record<string, unknown>`.

- [ ] Tests:
  - `select` with a label picks the option on a page of the fixture app (add a `<select id="pick">` to it);
  - `secretsFor` set, then get, keeps a `token:` written before;
  - `init` runs once per seat in a two-seat scene (the fixture adapter counts its calls into the state);
  - bad `adapter_options` fails the run, naming the option.
- [ ] Run them and see them fail. Implement. Run them and see them pass. Commit "select, init per seat, adapter
  options and secrets".

### Task 2: `app.serve`

**Files:** Create `src/app/serve.ts`, `tests/unit/serve.test.ts`, `tests/fixtures/serve-app.mjs` (a node http server
taking `--port`, writing a `token` file into `$APP_DATA`, answering `/health` after a 0.5 s delay). Modify
`src/model/schema.ts` (`app.serve`; `base` optional when `serve` is set), `src/record/recorder.ts`,
`src/record/session.ts` (`token_file`).

**Interfaces:**
- `appBase(project): string`: `app.base`, or `http://127.0.0.1:{port}`.
- `appData(projectKey): string`: `~/.reel/apps/<key>/data`.
- `withApp(project, fn: (app: { base: string; data: string; startedByUs: boolean }) => Promise<T>, log): Promise<T>`.
  1. Take the project app lock, `~/.reel/locks/<key>--app.lock`, the same mechanism as `withMissionLock`.
  2. If the port answers `ready`, use that app. If the port answers something else, fail with
     `ReelError(1, "port 7820 answers <status> on /api/health: it isn't <project>'s app")`.
  3. Otherwise spawn the command (placeholders `{port}` and `{data}`; cwd and env expanded; output to
     `~/.reel/apps/<key>/serve.log`), then poll `ready` every 250 ms for at most 60 s. A failure says
     `"<project>'s app didn't start: <last 10 lines>"`.
  4. Run `fn`, then stop the app when Reel started it: SIGTERM, then SIGKILL after 10 s.
- `resetApp(projectKey)`: moves data to `data.old-<time>` (keeping only the newest old one), removes the project's
  state bags and the `adapter:` secrets.
- Recording (`recordMission`) runs inside `withApp` when `app.serve` is set. If the data folder has no
  `.reel-seeded`, it seeds first (Task 3).
- `RecordOptions.fresh` and `reel record --fresh` call `resetApp` first.

- [ ] Tests:
  - the app starts, reaches `ready`, the token is read from `token_file`, and the app is stopped afterwards (its pid
    is gone);
  - a second `withApp` while one runs reuses it;
  - a port held by another server that answers 404 fails with the message;
  - a command that exits at once fails with its output;
  - `resetApp` moves data and clears the state bag and secrets.
- [ ] Run them and see them fail. Implement. Run them and see them pass. Commit "app.serve: Reel starts, reuses and
  stops a project's app".

### Task 3: The seed hook and `reel app`

**Files:** Modify `src/adapter/api.ts` (`Adapter.seed?(ctx: SeedContext)`), `src/app/serve.ts`. Create
`src/app/seed.ts`, `src/cli/commands/app.ts`, `tests/unit/seed.test.ts`.

**Interfaces:**
- `SeedContext`:
  - `{ base, data, api: APIRequestContext, options, secrets, log }`;
  - `run(cmd, args, { env?, cwd? })`, using `util/proc.run` with the serve env merged;
  - `stopApp()`, `startApp()`, `saveLogin(storageState)`, which writes `authFile(key)`.
- `seedApp(project, log)`: calls `adapter.seed` inside `withApp`, then writes `{data}/.reel-seeded`.
- CLI:
  - `reel app serve <project>` runs in the foreground until Ctrl-C;
  - `reel app seed <project>`;
  - `reel app reset <project>`;
  - `reel app status <project>` (port, running, seeded, data size).

- [ ] Tests:
  - the fixture adapter's `seed` (add one: it `stopApp`s, writes a file into data, `startApp`s, and saves a login)
    runs, `.reel-seeded` is written, `authFile` exists;
  - recording into an unseeded data folder seeds first.
- [ ] Run them and see them fail. Implement. Run them and see them pass. Update `docs/adapters.md` (seed, options,
  secrets, select, init per seat). Commit "The seed hook and reel app".

## reel-delve

### Task 4: Scaffold and the fake Delve

**Files:** `~/claude/reel-delve/`:
- `package.json` (name `reel-delve`, type module, `main: dist/index.js`, devDependency `reel` as `file:../reel`, zod,
  vitest, typescript, playwright 1.64.1)
- `tsconfig.json`, `src/index.ts` (`defineAdapter({ name: "delve", version, steps: {}, masks, init })`)
- `tests/helpers/delve.ts`: `startFakeDelve(port): Promise<{ base, stop }>`. It runs `uv run python -m
  tests.e2e.fake_play_server --port N` in `DELVE_REPO` and waits for `/api/modules`.
- `tests/helpers/reel.ts`: a studio in tmp with project `delve` (`app.base` = the fake, `auth: none`, this adapter by
  path) and a mission per test. It records one scene with Reel's `recordMission` and returns its timeline and state.
- `.gitignore`, `README.md`, `CLAUDE.md` (Tasker REEL, the design's path)

- [ ] Test: the adapter loads in Reel (`loadAdapter`), and `startFakeDelve` lists the Crypt of Saint Vellis module.
  Commit "Scaffold: the adapter and a fake Delve for its tests". Add the GitHub remote and push.

### Task 5: DM steps: act, dm-done, ask

**Files:** `src/steps/dm.ts`, `tests/dm.test.ts`.
- `dm-done({ title? })`: a marked wait (default "Waiting for the DM (cut or speed up)"). `[data-testid=thinking]` shows
  (60 s at most, optional) and hides (15 min), then `settled("[data-testid=story]")`.
- `act({ text, button = "act", caption? })` (costs, changes): types into `[data-testid=composer] textarea`, clicks the
  button's test id, keeps the caption up (`keep: true`, `place: top`), waits with dm-done, then unsays.
- `ask({ question, say? })` (costs): clicks `mode-ask`, types, clicks `ask`, then a marked wait until the new `asked`
  item no longer says "Answering…" and has settled. It returns the answer's text.

- [ ] Tests on the fake: a scene opens the crypt's campaign (`delve.open-campaign`, Task 6's step, which can come
  first here as a plain `goto` to the campaign's play URL from `/api/campaigns`). It acts "I look around", and its
  timeline has a `wait` with `end > t`. Ask returns non-empty text. Under dry, act sends nothing (the story's count
  doesn't change). Commit.

### Task 6: Campaigns, preferences, seats

**Files:** `src/steps/campaign.ts`, `src/steps/prefs.ts`, `src/steps/seats.ts`, tests for each.
- `new-campaign({ module, name?, ruleset?, setting? })`: the `form#new-campaign` flow from delve-video's
  5-srd35.spec.mjs, on camera. It returns the campaign id from the URL after starting.
- `open-campaign({ campaign })`: an id, or a key in the state bag; goes to the play page.
- `set-language({ code, back? })`, `set-painter({ label, say? })` (returns the label it replaced),
  `restore-painter({ from })`: ported from lib/delve.mjs.
- `seat({ who, role?, name?, campaign })` on its seat, through `ctx.api` (the host's) to get the invite and the seat's
  own `page.request` to make or log in. The password goes to `ctx.secrets` under `seat.<username>`; a failed login
  makes the account again.
- `character({ name, campaign, seat? })`: ported `castCharacter`.

- [ ] Tests on the fake:
  - new-campaign of the crypt module returns an id that `/api/campaigns` lists;
  - set-language nl then en changes `html[lang]`;
  - set-painter returns the previous label and restore puts it back;
  - seat twice: the first makes the account, the second logs in; after deleting the secret, it makes it again;
  - character is made once, not twice.

  Commit.

### Task 7: Maps, masks, init, seed

**Files:** `src/steps/maps.ts`, `src/seed.ts`, `tests/seed.test.ts`.
- `zoom-map({ marker, notches })` and `hover-room({ room })`: ported `zoomMapOn` and `roomPoint`.
- `masks`: `.campaign-list-head`, `.campaign-group`, `[data-testid=account-menu]`. `init` sets the localStorage presets
  on every seat: `delve.tours.skipped=1`, `delve.didYouKnow=off`, `delve.modulesLayout=cards`.
- `options` schema: `{ seed: { from: { base, token_file }, packs: string[], owner: { username, display_name }, modules: string[] } }`.
- `seed(ctx)` follows the design's three steps (packs with the app stopped, first-owner or login, modules by title,
  skipping those there already). A missing title fails, listing the closest titles.

- [ ] Tests: two fake Delves (47910 standing in for the real one, 47911 the demo).
  - The seed imports the crypt module into the demo and saves a login.
  - Seeding again skips it and logs in.
  - A missing title fails, naming it.
  - Packs: the source folders of srd35 and osric install. The fake already has them, so it checks that it doesn't
    fail on reinstalling.

  Commit and push.

### Task 8: The studio's Delve project

- [ ] Write `~/reel-studio` (make it with `reel init` if it doesn't exist) `projects/delve/project.yaml` with
  `app.serve` on 7820, this adapter, `adapter_options.seed` (the real Delve read-only, the packs' source folders, the
  modules of the tour and SRD 3.5), the style (wise-lady, en and nl, fantasy moods, the masks) and a one-scene smoke
  mission `smoke` (open the Modules page, one caption).
- [ ] Run `reel app seed delve` (it only reads the real Delve), then `reel record delve/smoke --dry` and `reel record
  delve/smoke`. Expected: exit 0, and a frame shows the seeded modules.
- [ ] Update Tasker: REEL-49 goes to in_review with a comment. REEL-50 stays open for the chapters.
