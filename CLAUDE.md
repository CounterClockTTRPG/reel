# Reel

## Backlog: Tasker

This project's backlog lives in Tasker (http://localhost:7778), project key **REEL**, not in markdown files.
Read `curl -s http://localhost:7778/api/guide` once per session before using it. At the start of a session check
`curl -s "http://localhost:7778/api/projects/REEL/items?sent_back=true"` for work the owner sent back. File new work as
items, move what you work on to `in_progress`, and to `in_review` with a comment when done; the owner accepts it.
Never delete, cancel instead.

## What it is

The requirements are docs/requirements.md; each requirement's id (FILM-1, REC-1, ...) is the Tasker item it belongs to.
The working predecessor is ~/claude/delve-video (Playwright stage, join, voice-over, score): read it before building.

## Rules

- No secrets in the repository or in films (tokens from the environment or a file outside the film).
- The owner's music (~/music, Monument Studios, CC BY 4.0) is never committed; Reel credits what a film uses.
- Every paid call (TTS) is cached and counted; a run says what it would spend first.

## Working on Reel

- Build with `npm run build` (tsc and the web UI into `dist/`). Tests: `npm test` (unit, records against
  `tests/fixtures/app`), `npm run test:e2e` (the CLI end to end), `npm run test:ui` (the web UI). The recorded fixture
  take is cached in the system temp dir (`reel-test-cache`), keyed by the fixtures and `src/record`.
- Reel is generic: no application's names, selectors or steps in `src/` or `web/`. Application knowledge goes in an
  adapter outside this repository (`docs/adapters.md`).
- The studio (`REEL_STUDIO`, default `~/reel-studio`) is the owner's; the vault (`REEL_DATA`, default `~/.reel`) holds
  recordings, takes, caches and secrets. Never commit either here.

## Making a film from a session

1. `reel record <p/m> --dry`: every scene's steps still find their elements (exit 1 names the scene and step, with a
   screenshot).
2. `reel record <p/m>`, then `reel check <p/m>` (exit 3 means private data is on screen: add a mask, record again).
3. `reel make <p/m>` prints what the narration would cost and stops with exit 4. Tell the owner the amount; only pass
   `--yes` (or `--budget`) when they agreed to spend it.
4. The owner reviews the take in the web UI. `reel record <p/m> --flagged` retakes what they flagged.
5. `reel translations <p/m> --json` lists the lines to translate; write them with `--set <key> --lang <code> --text`.
