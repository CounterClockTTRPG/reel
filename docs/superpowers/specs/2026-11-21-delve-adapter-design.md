# The Delve adapter and a separate Delve to film: design

Status: draft for the owner's approval, 2026-11-21. Tasker: REEL-49 (the adapter), and the start of REEL-50 (the
films). Builds on [the Reel design](2026-11-21-reel-design.md).

## Intent

Remake the Delve tour and the SRD 3.5 film with Reel, without touching the owner's real Delve. Reel starts a separate
Delve whose data lives in the vault. The data is seeded once with the packs, a demo owner and the modules the films
show, copied read-only from the real Delve. It is kept between runs, so retaking one scene finds the campaign an
earlier scene made, and `--fresh` starts it over. The Delve adapter gives scripts Delve's own steps.

## Decisions (the owner's)

- Recording runs against a **separate Delve, never the real one**. Port 7810 may be the instance behind delve.party.
- Its data is **kept per project in the vault**: `--fresh` wipes it. It is not a fresh instance per run, which would
  break single-scene retakes, and not a snapshot, which is REC-5 and later.
- **Seeding** copies the listed modules out of the real Delve as `.dscn` exports (read-only, with the owner token)
  and imports them into the separate one, with the packs and a demo owner account.
- **Reel starts the app** (a generic `app.serve`); the adapter seeds it and adds steps (approach A). Approach B, where
  each adapter starts and stops its app itself, was rejected: every adapter would repeat the same work.
- The adapter is its **own repository**: `~/claude/reel-delve`, pushed to github.com/CounterClockTTRPG/reel-delve.

## Non-goals

- Changing Delve. If a step needs a `data-testid` Delve lacks, that is filed in Delve's backlog (DEL), not patched
  around with fragile selectors.
- Remaking the five chapters themselves. That is REEL-50, the next plan.
- Writing to the real Delve: seeding only reads from it (GET `/api/modules`, GET `/api/modules/{id}/export.dscn`).

## Part 1: Reel

### `app.serve` (generic)

```yaml
# projects/delve/project.yaml
app:
  auth: login                   # the host is the demo owner account, logged in by the seed (see Seeding)
  serve:
    command: [uv, run, delve, serve, --port, "{port}", --host, 127.0.0.1]
    cwd: ~/claude/refactoring
    port: 7820
    env: { DELVE_DATA_DIR: "{data}" }
    ready: /api/health          # GET until it answers 2xx (timeout 60 s)
  local_storage: { ... }
```

- With `serve`, `base` defaults to `http://127.0.0.1:{port}`. `{data}` is `~/.reel/apps/<project>/data`, made on
  first use with mode 0700.
- `reel record` (real and dry), the jobs that record, and `reel app seed` start the app when nothing is listening on
  the port, wait for `ready`, and stop it afterwards. A process Reel did not start is used as it is when the port
  answers `ready`. A port that answers something else fails the run with the port named.
- `reel app serve <project>` runs it in the foreground, to try things in a browser. `reel app stop <project>` stops
  one left running.
- `reel record --fresh` (and `reel app reset <project>`) first stops the app, moves `{data}` to
  `~/.reel/apps/<project>/data.old-<time>` (one kept, the older ones removed) and clears the mission's state bag.
- `serve.token_file` (optional, for apps recorded with `auth: token`) is read after start for the Bearer token.
- **One app per project at a time** *(builder's call)*: a project's app runs under a project lock (`withMissionLock`'s
  sibling, `~/.reel/locks/<project>--app.lock`), so two recordings of missions in the same project queue one after
  the other instead of one stopping the app under the other.
- **After `--fresh`, recording seeds again by itself** *(builder's call)*. A data folder without `.reel-seeded` (written
  by a successful seed) is seeded before recording. `--fresh` clears every mission state bag of the project, and the
  adapter's secrets, since the accounts they name are gone.
- The app's output goes to `~/.reel/apps/<project>/serve.log`; a failed start prints its last lines.

### Adapter additions

- `seed?(ctx)`: run by `reel app seed <project>` (and before recording into an unseeded data folder). `ctx` holds:
  - `base`, `data` (the data folder), `api`, `options`, `secrets`, `log`;
  - `run(command, args, {env, cwd})`, `stopApp()` and `startApp()`, so seeding can use the app's own CLI on its data
    while the app is stopped;
  - `saveLogin(storageState)`, which writes `~/.reel/auth/<project>.json` for `auth: login`.
- `options`: project.yaml's `adapter_options:` (free-form), checked by the adapter's optional `options` Zod schema.
- `ctx.secrets` in steps and seed: `get(key)` and `set(key, value)` in `~/.reel/secrets/<project>.yaml` under
  `adapter:`. It holds the seats' passwords and never touches the studio.
- `init({ page, state, seat })` now runs for every seat's page, not only the host's.
- A core step `select: { target, value? | label? }` (Playwright `selectOption`, the cursor glides to it first). Films
  fill forms on camera; `delve-video` did it inline.

## Part 2: reel-delve

A TypeScript ESM package. It depends on `zod` and on `reel` as a type-only peer: `defineAdapter` and the types from
`reel/adapter`.

### Steps

Each is carried over from delve-video's `lib/delve.mjs` and the chapter specs. A dry run skips or stubs every step
marked **changes** or **costs**.

| Step | Arguments | Does | Marks |
| --- | --- | --- | --- |
| `delve.act` | `text`, `button?` (act, pass), `caption?` {label, text} | types a turn in the composer, sends it, and waits for the DM (`dm-done`), with a caption held over the wait | costs, changes |
| `delve.dm-done` | `title?` | the marked wait for the DM: the thinking clock comes and goes, then the story stops changing | |
| `delve.ask` | `question`, `say?` {label, text} | ask mode, sends the question, waits for the answer (a marked wait), optionally captions it | costs |
| `delve.new-campaign` | `module` (title), `name?`, `ruleset?`, `setting?` | fills the New campaign form on camera and starts it; returns the campaign id (use `as:`) | changes |
| `delve.open-campaign` | `campaign` (an id, or a state key) | opens the campaign's play screen | |
| `delve.set-language` | `code`, `back?` | the side bar's language switch, then back to the page it was on | changes |
| `delve.set-painter` | `label`, `say?` | Preferences, Backends: sets the portrait painter; returns the one it replaced | changes |
| `delve.restore-painter` | `from` (a state key) | puts back the painter `set-painter` replaced, when it changed | changes |
| `delve.seat` | `who`, `role?` (player, observer), `name?`, `campaign` | on its seat: makes the seat's account through the table's invite the first time (password into `ctx.secrets`), logs in later times (and makes the account again when a kept password no longer logs in), takes the seat, and opens the play screen; it can be repeated | changes |
| `delve.character` | `name`, `campaign`, `seat?` | the host makes a character by name, unless it exists, and gives it to the seat | changes |
| `delve.zoom-map` | `marker`, `notches` | zooms the world map in on a marker one notch at a time (Leaflet drifts) | |
| `delve.hover-room` | `room` | glides to a point on a map room's floor, for its tooltip | |

Masks: the campaign list's player names (`.campaign-list-head`, `.campaign-group`) and the account menu. The
localStorage presets (no tour popups, no "Did you know", module cards) are set by `init` on every seat.

### Seeding (`reel app seed delve`)

```yaml
adapter_options:
  seed:
    from: { base: http://127.0.0.1:7810, token_file: ~/.local/share/delve/token }   # read only
    packs: [~/claude/refactoring/packs/srd35, ~/claude/refactoring/packs/osric, ~/claude/delve-packs/greyhawk]   # pack source folders
    owner: { username: demo, display_name: The host }
    modules: [The Sunless Citadel, Sinister Secret of Saltmarsh, Against the Cult of the Reptile God]
```

1. With the app stopped: `delve pack install <folder>` for each pack, run with `DELVE_DATA_DIR={data}`. Packs come
   from their source folders (Delve's checkout, `~/claude/delve-packs`), never from the real Delve's data folder.
2. Start the app and make the demo owner with `POST /api/accounts/first-owner` (allowed from this machine while the
   install has no owner). The password is generated and kept in `ctx.secrets`, and the logged-in session is saved
   with `saveLogin`, so the host records as "The host" with a session cookie. When the owner exists already, seeding
   logs in with the kept password instead.
3. For each module title: find it in the real Delve's `/api/modules`, GET its `export.dscn`, and
   POST it to the separate Delve's `/api/modules/import`.
   - A title already imported is skipped, so seeding can be run again.
   - A title missing from the real Delve fails, naming it.
4. Print what was installed and imported. The real Delve's token is read from its file at the moment it's needed,
   never written anywhere.

### Tests

- The steps run against Delve's own fake play server (`python -m tests.e2e.fake_play_server` from the Delve checkout,
  `DELVE_REPO`, default `~/claude/refactoring`), so the DM's turns come from Delve's fake `claude` and nothing costs
  money.
  - It starts a fresh data folder with a module and a campaign.
  - The tests cover: act and dm-done, ask, new-campaign, set-language, set-painter and restore-painter, seat (two
    runs: making the account, then logging in), and character.
- Seeding is tested against two fake play servers, one standing in for the real Delve: a module is exported from one
  and imported into the other, and a second seed skips it.
- Reel's side: unit tests for `app.serve` (start, ready, reuse, a wrong port's message, `--fresh`), `ctx.secrets`,
  `select`, and `seed`, using the fixture app served by a tiny command.

## Left to the builder

The exact selectors (from Delve's `data-testid`s, as delve-video used them), the ready path if Delve has no
`/api/health` (any cheap GET), how the fake play server's port and data folder are passed, and the module list's
exact titles.
