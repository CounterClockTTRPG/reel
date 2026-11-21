# Reel

Narrated tour and tutorial videos of web applications, for YouTube, from scripts. Reel is a studio:

- **Projects** are your applications. A project points Reel at a web address, and its style sets the narrator, music
  moods, languages, cards, transitions, loudness and privacy masks.
- **Missions** are the videos you want to make. Each is a script of scenes, and it can override the project's style.
- **Takes** are recordings of a mission. One bad scene is retaken alone; the others are reused.
- **Libraries** are shared by every project: music (your own files, tagged with moods), voices and effects
  (transitions, card templates, the overlay's look).

`reel` records a mission scene by scene in a browser, checks the frames for private data, cuts the waits, adds the
narration and the music, and packages the take for YouTube. `reel serve` is the web UI where you manage the studio and
review takes. Reel knows no application of its own; an adapter plugin adds an application's own steps (see
[docs/adapters.md](docs/adapters.md)).

The requirements are in [docs/requirements.md](docs/requirements.md), the design in
[docs/superpowers/specs/2026-11-21-reel-design.md](docs/superpowers/specs/2026-11-21-reel-design.md), the backlog in
Tasker (project **REEL**).

## Install

You need Node.js 24, ffmpeg and tesseract (for the privacy check) on the PATH.

```sh
# Linux
sudo apt install ffmpeg tesseract-ocr
npm ci
npx playwright install chromium
npm run build
npm link            # puts `reel` on the PATH (or run node dist/cli/main.js)
```

On Windows: `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg UB-Mannheim.TesseractOCR`, open a new terminal, then run the
same `npm` commands in PowerShell.

## A first film

```sh
reel init                                   # ~/reel-studio, a git repository of its own (or REEL_STUDIO=...)
reel new project guild --base http://localhost:3000
reel new mission guild/first --title "Guild: a first look"
# edit ~/reel-studio/projects/guild/missions/first/chapters/01-start.yaml (or in the web UI)
reel record guild/first --dry               # click through every scene; nothing that costs money
reel record guild/first                     # take 1
reel make guild/first                       # says what the narration costs and stops (exit 4)
reel make guild/first --yes                 # check, cut, voice, mix, package
```

The package is in `~/.reel/takes/guild/first/1/package/`: `video.mp4`, an `.srt` per language, `chapters.txt` for the
description box, `description.md` and `thumbnail.png`.

## Where things are

| | |
| --- | --- |
| `~/reel-studio` (`REEL_STUDIO`) | the studio: `studio.yaml`, `library/`, `projects/<project>/project.yaml`, `projects/<project>/missions/<mission>/` (mission.yaml, chapters/, translations/). Text only; keep it in git. |
| `~/.reel` (`REEL_DATA`) | the vault, never in git: recorded scenes, takes, the voice cache, `spend.jsonl`, saved logins (`auth/`), secrets (`secrets/<project>.yaml`, `secrets/replicate.yaml`), job logs |
| `~/music` (`music_root` in studio.yaml) | your music; `reel music scan` adds it to `library/music.yaml`, where you give tracks their moods. Never committed. |

Tokens never go in the studio: a project's API token is `REEL_TOKEN_<PROJECT>` or `token:` in
`~/.reel/secrets/<project>.yaml`; the narrator's Replicate token is `REPLICATE_API_TOKEN` or `token:` in
`~/.reel/secrets/replicate.yaml`.

## A script

A mission's chapters are YAML files of scenes. A scene is what gets retaken on its own; its `say` steps are its captions,
and the review shows one frame for each.

```yaml
title: The basics
setup:                     # before the chapter's first recorded scene; never shown
  - goto: /preferences
scenes:
  - id: rulebook
    music: library         # a mood from the music library, or a track's file or id
    steps:
      - goto: /rulesets/srd35          # every scene starts on a fresh page
      - card: { title: Delve 1.4, text: Dungeons and dragons by the 3.5 rules. }
      - wait-for: section.page
      - uncard
      - say: { label: SRD 3.5, text: Delve now plays by the SRD 3.5., spoken: "Delve now plays by the S R D three point five.", spot: section.page }
  - id: campaign
    needs: [rulebook]      # uses state an earlier scene left; retaking that one makes this one stale
    speed: 3               # waits in this scene play 3× faster, with a badge, instead of being cut
    steps:
      - goto: /campaigns
      - delve.new-campaign: { module: The Sunless Citadel }   # an adapter's step
        as: campaign                                         # keep its result for later scenes
      - click: { target: "#start", optional: true }          # no failure when it's missing
      - wait: { title: The DM thinks, until: "[data-testid=story]" }   # a marked wait: cut in the edit
```

Core steps: `goto`, `navigate`, `click`, `hover`, `type`, `scroll`, `zoom`, `say`, `unsay`, `card`, `uncard`, `spot`,
`wait-for`, `wait`, `pause`, `mark`, `css`, and `parallel: [[steps], [steps]]` for several seats at once. Any step may
have `optional`, `if: <selector>`, `seat: <name>` and `as: <key>`.

## Commands

| Command | Does |
| --- | --- |
| `reel record <p/m> [--scene id...] [--flagged] [--all] [--dry] [--headed]` | record the scenes that changed (or the named or flagged ones) and make a new take |
| `reel takes <p/m>` | the takes, with flagged and stale scenes |
| `reel review <take> --approve <scene> \| --flag <scene> --note "..." \| --status approved` | review from the command line |
| `reel check <take>` | the privacy frame check (OCR against the style's private strings) |
| `reel cut <take>` | cut the waits, join the scenes and cards, chapter marks |
| `reel voice <take> [--yes] [--budget usd] [--force]` | the narration; prints its cost first |
| `reel mix <take>` | the score and the mix, and the loudness check |
| `reel package <take> [--allow-missing] [--frame s]` | the YouTube package |
| `reel make <take> [--yes] ...` | check, cut, voice, mix and package in one go |
| `reel translations <p/m> [--lang nl] [--set key --text "..."]` | what is left to translate (`--json` lists it) |
| `reel music scan` | add new tracks from the music root, mark vanished ones missing |
| `reel new project <key> --base <url>`, `reel new mission <p/m>`, `reel init` | make things |
| `reel login <project>` | log in by hand once; the session is kept in the vault |
| `reel serve [--port]` | the web UI |

A take is `project/mission/n`, or `project/mission` for the latest. Every command takes `--json`.

Exit codes: **0** done, **1** failed (a scene's step, a tool), **2** usage, **3** a check failed (privacy, loudness,
missing translations, a flagged or stale scene before voicing), **4** it would spend money and `--yes` wasn't given.

## The web UI

```sh
reel serve                  # http://127.0.0.1:7779
make service                # as a systemd user service (deploy/reel.service)
```

It manages the studio (projects, their style, missions and their scripts, translations), runs dry runs, recordings and
makes, and reviews takes: each scene's frames with their captions and spoken lines, approve or flag with a note, the
finished video with its chapters, the privacy and loudness checks, and the YouTube package. The library screens tag
music with moods, play voice samples and preview transitions and cards; Spend shows what the narration has cost. There
is no login: it listens on 127.0.0.1 unless `studio.yaml` sets `host` and `allowed_hosts`, and then belongs behind a
firewall rule as Tasker does.

## Develop

```sh
npm test            # unit tests (records against a small fixture app)
npm run test:e2e    # the pipeline through the CLI
npm run test:ui     # the web UI
npm run dev         # the UI with hot reload, against a running `reel serve`
```
