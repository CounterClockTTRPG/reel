# Reel: design

Status: draft for the owner's approval, 2026-11-21. Builds on [docs/requirements.md](../../requirements.md), which it
amends where marked **(changed)**. Requirement ids (FILM-1, REC-1, ...) are the Tasker items of project REEL.

## Intent

The owner publishes narrated tour and tutorial videos of their own applications (Delve first; Guild, Tasker, and later
Godot games such as Driftward) on YouTube. `~/claude/delve-video` made two such videos (the October tour, the 1.4 SRD
3.5 film) but every film was code, a bad scene meant re-recording a chapter, frames were checked by hand, and private
data had to be hidden by ad-hoc CSS.

Reel turns that into a **studio**: one place that holds every project, every video the owner wants to make (a
**mission**) and every recording of it (a **take**), with a shared library of music and effects and a style per
project. Claude sessions do most of the work from the command line, unattended; the owner manages the studio and
reviews takes in a web UI.

Success for the first milestone: the Delve tour and the SRD 3.5 film are remade in Reel as two Delve missions, reviewed
in the web UI, packaged for YouTube, and delve-video retires.

## Goals

The six goals of the requirements stand (a new film is mostly writing; one bad scene is retaken alone; nothing private
slips through; a film is checked fully before it is voiced or published; re-making for a release costs only what
changed; the output is ready for YouTube). Added by the owner:

7. **Central management (new).** Projects → missions → takes are managed in one place, in a web UI and from the CLI.
8. **Central libraries (new).** One music library and one effects library (transitions, card templates, the overlay's
   look) shared by all projects.
9. **Project style (new).** A project sets the defaults its missions inherit: voice, music moods, languages, cards,
   transitions, loudness, masks, private strings. A mission overrides any of them.
10. **Not only web apps, later (new).** The engine is split so a second driver (Godot) can be added without touching
    the editing, sound, review or packaging.

## Non-goals

- A general video editor or timeline (unchanged).
- Uploading to YouTube (unchanged).
- A hosted multi-user service: one owner, no accounts; reachable on the LAN like Tasker (unchanged in spirit).
- Machine translation: translations are written (by Claude in a session or by the owner), never bought.
- In milestone 1: recording non-web applications. **(changed)** No longer a non-goal overall; it is milestone 2.

## Anti-goals

Unchanged: a take that looks finished but shows private data, a wrong claim, or a half-loaded page; music that drowns
the narration; a film that breaks silently when the app changes. Added: **the web UI and the CLI disagreeing** about a
mission (they read and write the same files through the same code), and **a paid call made without a stated
estimate** (TTS estimates first, in the CLI and in the UI).

## Constraints

From the requirements: Node 24 + Playwright, ffmpeg on the PATH, Linux and Windows, the owner's music never committed,
TTS cached and counted with an estimate first, no secrets in the repository or in the studio.

The tool's code is pushed to https://github.com/CounterClockTTRPG/reel.

## Approaches

Where the hierarchy is managed:

- **A. Files plus a review page.** The studio a folder of YAML, the web page only for review. Least to build, but the
  owner would edit YAML to change a style or a mission.
- **B. A Tasker-like web app over the same files (chosen by the owner).** A Reel server with a web UI for managing
  projects, missions, takes, libraries and style, and for reviewing; the CLI stays the first way to work and can do
  everything the UI can.

How it is built (B):

1. **All TypeScript on Node 24 (chosen by the owner):** the CLI, a Fastify server and a React/Vite UI in one
   repository, one film model, the recorder and the ffmpeg steps in the same process as the server. delve-video's
   code is Node already and carries over.
2. Python server like Tasker, Node recorder as a subprocess: two languages and the film model twice.
3. Node server with server-rendered pages: least tooling, but the reviewer, the music browser and the style editors
   outgrow it.

Scope of the web UI: all of it in milestone 1 (chosen by the owner), not a review page first.

Application knowledge: none in Reel; adapters are plugins built separately (chosen by the owner), see Adapters.

Languages: one recording per mission, narrated in the project's first language, with an `.srt` per supported language
(chosen by the owner). Dubbed narration and translated on-screen captions stay later work (FILM-4, PUB-2).

Non-web applications: the driver/overlay split in milestone 1 with only the browser driver; the Godot driver in
milestone 2, proven on Driftward (chosen by the owner).

## The studio

Two places, kept apart so the studio can be a git repository and the heavy files never are:

- **The studio** (`REEL_STUDIO`, default `~/reel-studio`): a git repository of the owner's, holding only text.
- **The vault** (`REEL_DATA`, default `~/.reel`): recordings, takes, caches, job logs, saved logins and secrets.
  Never in git.

```
~/reel-studio/
  studio.yaml                      the music root (~/music), the server's port and allowed hosts
  library/
    music.yaml                     one entry per track: file (relative to the music root), title, artist, album,
                                   licence, attribution line, moods, length; made by `reel music scan`
    voices.yaml                    named voices: provider, model, voice id, language, price per 1000 characters
    effects/
      transitions.yaml             named transitions: kind (an ffmpeg xfade transition or fade-through-black), length
      cards/<name>.html            card templates (opening, chapter, credits, end card) with slots
      overlays/<name>.css          the overlay's look: cursor, ripple, caption, spotlight, speed-up badge
  projects/
    delve/
      project.yaml                 name, adapter (delve), app (base URL, auth), style (below)
      missions/
        srd35/
          mission.yaml             title, overrides of the style, chapters, opening/closing, outputs
          chapters/01-srd35.yaml   the scenes of a chapter
          translations/nl.yaml     the spoken lines in another language, by scene and line
        tour/ ...
~/.reel/
  scenes/<project>/<mission>/<scene>/<recording-id>/   one recorded scene: video, timeline.json, frames/
  takes/<project>/<mission>/<n>/                        one take (below)
  voice-cache/                                          TTS lines by hash of provider|model|voice|text
  jobs/                                                 one log per job
  auth/<project>.json                                   a saved login (storageState)
  secrets/<project>.yaml                                tokens and seat passwords; or tokens from the environment
```

### Style and inheritance

`project.yaml` has a `style:` block; `mission.yaml` may have its own and wins key by key (a deep merge, lists
replaced). The effective style is what the UI shows, each value marked with where it came from.

```yaml
# projects/delve/project.yaml
name: Delve
adapter: ~/claude/reel-delve   # optional: a path or npm package name of an adapter plugin; without one, core steps only
app:
  base: http://localhost:8000  # any web URL; milestone 1 records against a local Delve server
  auth: token                # token (Bearer header from secrets or REEL_TOKEN_<PROJECT>) | login (saved storageState) | none
  local_storage: { delve.tours.skipped: "1", delve.didYouKnow: "off" }   # set before the app's own scripts
style:
  voice: wise-lady           # a name in library/voices.yaml
  languages: [en, nl]        # the first is the narration's; each gets an .srt
  music: { moods: [fantasy, calm], loudness: -33 }
  loudness: { voice: -16, music_under: 17, check_margin: 12 }
  overlay: classic           # library/effects/overlays/classic.css
  cards: { opening: classic, chapter: classic, credits: classic }
  transitions: { chapter: fade-black, card: crossfade, cut: crossfade-short }
  size: { width: 1920, height: 1080 }
  privacy:
    masks: [".campaign-list-head", ".campaign-group", "ul.module-cards"]   # hidden while recording
    strings: [tour-ana, tour-ben, "raf@", "/home/"]                         # searched for by OCR in every take
```

### Missions and scripts (FILM-1, FILM-2, FILM-3)

```yaml
# projects/delve/missions/srd35/mission.yaml
title: "Delve 1.4: SRD 3.5"
opening: { title: Delve 1.4, text: Now playing by the 3.5 rules., spoken: "Delve is a roleplaying engine, ..." }
chapters: [01-srd35]
cut_waits: true              # EDIT-1: marked waits are cut (or `speed` per scene)
interstitials: false         # a chapter card before each chapter
outputs: [youtube]           # milestone 1: the full video; EDIT-5 adds short, overview
```

```yaml
# projects/delve/missions/srd35/chapters/01-srd35.yaml
title: SRD 3.5
setup:                       # run before the first scene, not shown (the "(cut)" stretch of delve-video)
  - delve.set-painter: portraitgen (free)
teardown:                    # run after the last scene, even when a scene fails
  - delve.restore-painter
scenes:
  - id: rulebook
    music: library           # a mood, or a file from library/music.yaml
    steps:
      - goto: /rulesets/srd35
      - card: { title: Delve 1.4, text: Dungeons and dragons by the 3.5 rules. }
      - wait-for: section.page
      - uncard
      - say:
          label: SRD 3.5
          text: Delve now plays by the System Reference Document 3.5.
          spoken: Delve now plays by the System Reference Document three point five.   # optional
          spot: section.page
  - id: campaign
    needs: [rulebook]        # REC-1: state this scene uses from an earlier one (see Recording)
    steps:
      - delve.new-campaign: { module: The Sunless Citadel, ruleset: srd35, as: campaign }
      - delve.act: { text: "I look around.", caption: { label: The DM, text: The DM answers. } }
```

- A **scene** is the unit of retake. Its `say` steps are its captions; the review shows one frame per `say`.
- **Steps** are the core set (`goto`, `navigate`, `click`, `hover`, `type`, `scroll`, `zoom`, `say`, `unsay`, `card`,
  `uncard`, `spot`, `wait-for`, `pause`, `mark`, `wait` (a marked wait, start and end), `css` (a style for this scene))
  and the adapter's, prefixed with its name (`delve.act`, `delve.ask`, `delve.set-language`, `delve.set-painter`,
  `delve.new-campaign`, `delve.seat`). Targets are Playwright selectors (`text=`, `testid=`, CSS); a step may name a
  `seat` for the multiplayer chapter's other screens.
- **Logic in scripts** *(builder's call)*. The old chapter specs have branches, fallbacks and parallel players. The
  step language gets three things:
  - `optional: true` on any step: no failure when its target is missing.
  - `if: <selector>`: run the step only when the selector is there.
  - `parallel: [[steps], [steps]]`: seats acting at the same time.

  Anything beyond that, such as reading Delve's API, claiming a seat, or "check the box if it isn't", is an adapter
  step written in the adapter's code. There is no step that runs arbitrary code from a script. The adapter grows, but
  scripts stay data.
- Each step declares to the engine whether it **costs money or changes state**; `--dry` skips those and stubs what
  they would have returned (REC-4).
- The schema of every file is a Zod schema in Reel; the CLI (`reel check-film`), the server and the editor all
  validate with it and report errors with file, line and scene.
- Comments in the YAML are kept when the web UI writes a file (the `yaml` library's document API).

Translations (`translations/nl.yaml`) map `scene-id/n` (the n-th `say` of the scene, or `opening`, `chapter`) to the
translated line, with the hash of the source line it translates. A changed source line marks its translation stale; a
stale or missing translation fails `reel package` for that language with the list, unless `--allow-missing`.

## The engine

### Driver and overlay (goal 10)

- A **driver** starts the application, performs steps, and reports where things are (element boxes) and when
  (`timeline.json`). Milestone 1: the browser driver (Playwright, as delve-video). Milestone 2: the Godot driver (an
  addon in the game answering steps over a local socket, the window captured by ffmpeg).
- The **overlay** (cursor, ripples, captions, cards, spotlight) is one HTML/CSS/JS module, styled by the effects
  library's overlay CSS and driven by timeline events. The browser driver injects it into the page **live**, as
  delve-video does (proven, and the cursor follows real input). Milestone 2 adds a **post** renderer that plays the
  same module over a transparent page from the timeline and composites it with ffmpeg, for drivers without a page.
  Because the timeline records every overlay event with its element box, the post renderer needs nothing new from the
  browser driver. *(Builder's call, flagged for the owner: live first, post in milestone 2, so milestone 1 keeps
  delve-video's look exactly.)*

### Recording (REC-1..4, PRIV-1, KEEP-1)

- `reel record delve/srd35` records every scene **separately**: each scene its own browser context and video, all in
  the one browser and the one logged-in session, scenes run in order. A recorded scene is kept in the vault under a
  key of the scene's steps, the adapter's version and the app's base URL; `--scene campaign` retakes one, `--flagged`
  retakes the scenes the review flagged, `--all` retakes everything.
- **State between scenes:** the adapter has a state bag (delve-video's `tour-state.json`, per mission in the vault).
  A step's `as:` stores its result there. A scene's `needs:` names the scenes whose state it reads; retaking a scene
  marks those that need it as stale in the review (they are not retaken unless asked).
- **Setup and teardown** run around the scenes and are never shown; teardown runs even on failure.
- A **missing element** fails the run: exit code 1, the scene's id and step, `failure.png`, and the timeline so far
  (KEEP-1), in a dry run as in a real one.
- **Masks** (style `privacy.masks`, plus the adapter's own) are injected as `visibility: hidden` before the page's own
  scripts; `blur` per mask optional.
- **Auth** (REC-3): a Bearer token from `secrets/<project>.yaml` or the environment, or a saved login made by
  `reel login delve`. Seat passwords (the tour's ana, ben, cas) in the same secrets file.
- **Seats:** the multiplayer chapter records the other players' screens too (as delve-video); milestone 1 uses the
  host's screen only (picture-in-picture is EDIT-3).
- **Scene lifecycle** *(builder's call)*. Every scene starts with fresh contexts, both the host's and each seat's it
  names. Each context is logged in and opens the scene's first page. `delve.seat` is idempotent: a player already
  seated just opens the play screen. A stretch that cannot be split, such as a live session with typing indicators
  carried across moments, is written as one scene, and retaking it retakes the whole stretch.
- **Dry runs and state** *(builder's call)*. A dry run reads the mission's last real state bag, for example the
  campaign id a real take made. If there is none, a scene that needs that state is reported as "not reachable dry"
  and skipped with a warning; it does not fail the run.
- **Seat passwords** *(builder's call)*. The first real seating writes them to `~/.reel/secrets/<project>.yaml` (the
  vault), never to the studio.

### A take

A take is one numbered assembly of a mission: which recorded scene is used for each scene, and everything made from
them. Retaking a scene makes a **new take** that reuses the other scenes' recordings; earlier takes stay as they were.

```
~/.reel/takes/delve/srd35/7/
  take.json          the scenes used (scene id → recording id), the mission's file hashes, made when, by which command
  review.json        per scene: approved | flagged + note; who and when; the take's own status (draft, approved, published)
  checks/privacy.json, checks/loudness.json
  cut.mp4            the joined, cut video (no sound), markers.json, chapters.txt
  voice/             the narration track, lines.json (each line, its time, its cache file)
  mix.mp4            the video with narration and score
  package/           video.mp4, <lang>.srt, chapters.txt (YouTube timestamps), description.md, thumbnail.png
```

### The pipeline

Each step is a command, reads files, writes files, and can be run again alone:

| Command | Does | Requirement |
| --- | --- | --- |
| `reel record <p/m>` | record scenes, assemble a new take | REC-1..4, PRIV-1 |
| `reel check <take>` | the privacy frame check: OCR of one frame per second and per caption against `privacy.strings`; a hit fails with frame and scene | PRIV-2 |
| `reel cut <take>` | cut marked waits (keep 4 s of the start, 1.2 s of the end, 0.5 s crossfade) or speed them up with a badge; opening, chapter cards, transitions from the style, credits; chapter marks | EDIT-1, EDIT-2 |
| `reel voice <take>` | the narration: lines from the `say`s (or `spoken`), cached; prints characters, lines to buy and cost, and stops unless `--yes` or within `--budget` | SOUND-1 |
| `reel mix <take>` | the score (cues by scene mood or file, crossfaded, looped), voice and music each normalised to their own level, ducking, limiter; the loudness check | SOUND-2, SOUND-3 |
| `reel package <take>` | the YouTube package; the thumbnail from the opening card or `--frame <t>` | PUB-1 |
| `reel make <take or p/m>` | check → cut → voice → mix → package, stopping at the first failure and at the cost estimate | |

**Gates** *(builder's call)*. `reel voice` and `reel make` refuse a take while any of these is true:
- its privacy check failed
- a scene is flagged
- a scene is stale

Unreviewed scenes are allowed, because the review also needs the finished mix (REV-2). This way money is never spent
on a take that is going to be retaken anyway. `--force` overrides the flagged and stale gates, never the privacy one.

Exit codes: 0 done; 1 failed (a step, a missing element); 2 usage; 3 a check failed (privacy, loudness, missing
translation); 4 would spend money without `--yes`. Every command has `--json` for machine-readable output.

Music by mood: a scene's `music: library` picks a track from `library/music.yaml` whose moods include it, preferring
the project's `style.music.moods` and avoiding tracks already used in the mission; the choice is written into
`take.json`, so a take always sounds the same when remixed. The credits card lists the tracks used with their
attribution lines (SOUND-6 in its MVP form).

Cost: the voice cache is shared by all projects; a line costs only when its provider, model, voice or words changed.
Every paid call is appended to `~/.reel/spend.jsonl` (when, project, mission, take, characters, price); the UI shows
the totals.

## The web UI (`reel serve`)

One Fastify server on port 7779 (`studio.yaml`), on 127.0.0.1 by default and the LAN with allowed hosts like Tasker,
no login. It serves the React UI and a JSON API; the CLI and the server share the same library code. Jobs started from
the UI (record, dry run, check, make) run in the server one at a time per mission, with their log streamed to the page;
the CLI takes the same per-mission lock, so the two never record the same mission at once.

Screens:

- **Studio:** projects, each with its missions, each with its latest take's status (draft, flagged, approved,
  published) and its last run.
- **Project:** its style, edited in a form (voice from the library, moods, languages, cards, transitions, overlay,
  masks, private strings), the adapter, the app's address; secrets are never shown or edited here.
- **Mission:** its overrides (the effective style, each value marked inherited or overridden), chapters and scenes
  (a YAML editor with validation per scene, and a scene list to reorder), translations with stale lines marked, the
  takes, and buttons for dry run, record (all, a scene, the flagged), make.
- **Take review** (REV-1, REV-2): for each scene its frames, one per caption, with the caption and the spoken line;
  approve or flag with a note (saved to `review.json`; `reel record --flagged` retakes those); stale scenes marked;
  the finished video with its chapters; the privacy check (hits with their frames) and the loudness check; the YouTube
  package (description, chapters, thumbnail) and "mark as published".
- **Library:** music (play a track, edit its moods, see which missions use it, rescan), voices (with a sample line,
  cached), effects (each transition and card template previewed).
- **Spend:** TTS spend by project and mission, and what the next `make` would cost.

## Adapters (plugins)

**Reel knows nothing about any application (owner's decision).** It is a generic tool pointed at a web URL. Core steps,
the project's `app:` block (base URL, auth, localStorage presets) and the style's masks and private strings are enough
to film any web app. Application knowledge lives in an **adapter**, an ESM package built and versioned **outside
Reel's repository**. Reel loads it from the path or package name in `project.yaml`.

The plugin interface is a typed module, published from Reel as `reel/adapter`:
`export default defineAdapter({ name, version, steps, masks, privateStrings, init })`.
- Each step has a Zod schema for its arguments.
- Each step declares `costs` (money) and `changes` (state) for dry runs.
- Each step gets a `run(ctx, args)` with the scene's stage (`say`, `click`, `mark`, `wait`, ...), its seats, the state
  bag and Playwright's page.
- Its error messages name the scene.

Reel's own tests use a fixture adapter for a fixture web app, never Delve.

**The Delve adapter** is a separate project *(builder's call on where: `~/claude/reel-delve`, its own repository, own
Tasker items; the owner may move it into Delve's repository)*. It carries over from delve-video's `lib/delve.mjs`:
- `act` and `dm-done` (a marked wait), `ask`, `set-language`
- `set-painter` (and restoring the painter the owner had), `new-campaign`
- `seat` (seats a player through the table's invite)
- the masks Delve always needs

Building it comes after Reel's adapter interface exists. It is needed to close milestone 1, not to build Reel.

## Migration from delve-video

Once the Delve adapter exists, the five chapter specs become two Delve missions in the studio, recorded against a
local Delve server: `delve/tour` (chapters 1–4) and `delve/srd35`. Their
wording, cues and music choices are carried over as they are; the opening, credits and interstitials from `join.mjs`
become the missions' `opening` and the library's card templates; the SRD 3.5 score becomes scene moods (or files).
delve-video stays usable until both missions record, cut, voice, mix and package with Reel and the owner has approved a
take of each.

## Testing

- Unit tests (Vitest) for the schemas, style inheritance, the cut plan (wait cuts, segment times, chapter marks), the
  music choice, cache keys, translations' staleness, and the loudness check's reading of ffmpeg's output.
- An end-to-end test against a small fixture web app served by the tests (no Delve), with a fake TTS provider: record
  → check → cut → voice → mix → package on a three-scene mission, short enough for CI.
- Playwright tests of the web UI against a fixture studio: the studio page, a style edit written to the file, a review
  flag written to `review.json`.
- Linux in CI; the paths and child processes written portably for Windows, checked by hand on Windows before the
  milestone closes.

## Milestones

1. **Studio and MVP.** Everything above with the browser driver, **the whole web UI included (owner's decision)**: the
   requirements' MVP items, plus the studio, style, libraries, spend and the adapter interface. In parallel, as its
   own project, the Delve adapter. Done when the tour and SRD 3.5 are remade from the studio against a local Delve and
   delve-video retires.
2. **Godot.** The post overlay renderer, the Godot driver and addon, a Driftward mission.
3. After that, in the owner's order: REC-5..7, EDIT-3..6, SOUND-4..5, REV-3..4, PUB-2, KEEP-2..3, FILM-4.

## Backlog and documents

On approval: `docs/requirements.md` is amended (studio, web UI, languages as subtitles, non-web apps in milestone 2),
and Tasker gets new items in batch 1 for the studio, style, libraries, web UI and adapter interface, and a batch 2 for
Godot. The Delve adapter's items go in its own Tasker project (created with the owner's OK). The work is
pushed to CounterClockTTRPG/reel.

## Left to the builder

The overlay's live/post split as described (flagged above); the OCR engine for PRIV-2; the internal module layout; the
UI's component library; how the scene cache key is computed; frame sampling density for the privacy check; whether
`reel make` runs as one process or chains commands.
