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
