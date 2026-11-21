# Reel: requirements

Reel makes narrated tour and tutorial videos of web applications, for YouTube, from scripts kept in a repository. A
film is written once and recorded again whenever the application changes: the browser is driven by the script, the
narration and music are added afterwards, and a review page shows every scene before anything is published.

It grows out of `~/claude/delve-video`, the scripts that made Delve's October tour and the 1.4 SRD 3.5 video. Everything
that worked there carries over; what cost the most there (re-recording whole chapters for one bad scene, checking
frames by hand, wording changes that meant code changes, private data on screen) is what Reel is for.

## Who it's for

- **The owner**, publishing videos of their own applications (Delve, Guild, Tasker) on YouTube.
- **Claude sessions**, which write, record and fix films unattended: every step is a command with a plain exit code and
  files on disk, never a dialog.

## Shape

Amended 2026-11-21 by the design ([docs/superpowers/specs/2026-11-21-reel-design.md](superpowers/specs/2026-11-21-reel-design.md)):
Reel is a **studio**. Projects → missions (a video to make) → takes (recordings of it) are managed centrally, in a
web UI and from the CLI, with shared libraries of music, voices and effects, and a style per project. Reel is generic:
it is pointed at a web URL and knows no application; adapters are plugins built separately.

- **A command-line tool** (`reel`) does the work: record, cut, voice, score, package. Each step reads files and writes
  files, so a step can be run again alone, from a terminal, a Claude session or CI.
- **A web UI** (`reel serve`, amended: a Tasker-like app over the same files, not only a review page) manages the
  studio and shows a take for approval: one frame per caption with its spoken line, the
  scenes to approve or flag, and the finished video with its YouTube package. It serves files from the project; it is
  not a hosted service and has no accounts.
- **A mission** (amended: was "a film in the user's own repository") is a folder in the central studio
  (`~/reel-studio`, the owner's own git repository): `mission.yaml`, its chapters' scenes and translations. Reel's
  repository holds no missions; recordings and takes live in `~/.reel`, never in git.

## Goals

1. A new film is mostly writing: a script and a config, not code changes to the tool.
2. One bad scene is retaken alone, not the whole film.
3. Nothing private reaches a published video unnoticed.
4. A film can be checked fully before it is voiced or published.
5. A film is re-made for a new release with as little work as its changes need.
6. The output is ready for YouTube as is: video, captions, chapters, description, thumbnail.

## Non-goals

- A general video editor. Reel edits by rules (cut the waits, crossfade, draw callouts), not on a timeline.
- Recording desktop applications or games **in milestone 1** (amended: the Godot driver is milestone 2).
- Uploading to YouTube. Reel writes the package; the owner uploads it.
- A hosted, multi-user service.

## Anti-goals

- A take that looks finished but shows someone's private data, a wrong claim in a caption, or a half-loaded page.
- Music that drowns the narration (the voice is always clearly louder; checked by measurement, not by ear).
- A film that silently breaks when the application changes: a missing element fails the run with the scene's name.

## Requirements

Each requirement has an id for the backlog. **MVP** marks what the first version needs to replace `delve-video`.

### Films as data (FILM)

- **FILM-1 (MVP):** A film is a folder with `film.yaml` (title, chapters, opening and closing cards, credits, music,
  voice, loudness, privacy masks, outputs) and a script per chapter.
- **FILM-2 (MVP):** The script is Markdown or YAML scenes: each scene has its caption, an optional fuller spoken line,
  the steps that drive the browser, and its music mood. Wording is edited in the script; no code changes for it.
- **FILM-3 (MVP):** Steps are small named actions (`goto`, `click`, `type`, `scroll`, `zoom`, `say`, `card`, `wait-for`)
  plus the app adapter's own (for Delve: `act` and wait for the DM, ask the DM, set a preference). An adapter is a
  plugin package per application; Delve's is the first.
- **FILM-4:** A script can be translated: the same steps with another language's captions and narration.

### Recording (REC)

- **REC-1 (MVP):** Scenes are recorded separately and cached; `reel record film --scene 5` retakes one scene and keeps the
  others. A scene that depends on state the scene before it left says so in the script.
- **REC-2 (MVP):** The stage of `delve-video`: drawn cursor and click ripples, captions held as long as they take to
  read, title cards, spotlights, typing at a human pace, smooth scroll, marked waits.
- **REC-3 (MVP):** Recording against a local server with an API token (no browser login), or with a saved login.
- **REC-4 (MVP):** A dry run (`--dry`) clicks through every scene without calling anything that costs money or changes
  state (the adapter declares which steps those are).
- **REC-5:** Fixed starting data: an adapter can seed a demo state (a snapshot or a fixture campaign) before a scene, so
  every take starts the same.
- **REC-6:** Sharper picture: a headed browser captured at 60 fps with ffmpeg, beside Playwright's own video.
- **REC-7:** Zoom and pan onto the spotlighted element in post, so small text reads on a phone.

### Privacy (PRIV)

- **PRIV-1 (MVP):** Masks per film and per adapter: selectors hidden or blurred while recording (another user's names, a
  campaign list, an email address).
- **PRIV-2 (MVP):** A frame check: known private strings (account names, email addresses, local paths, tokens) listed
  in the config are searched for in the frames by OCR; a hit fails the take with the frame and the scene.
- **PRIV-3:** Secrets are never written into the film's folder (tokens from the environment or a file outside it).

### Editing (EDIT)

- **EDIT-1 (MVP):** Marked waits are cut, keeping enough of the wait's start to read its caption and a little of its end,
  with a short crossfade (`delve-video`'s rule), or sped up (2–4×, with a badge) where a scene asks for it.
- **EDIT-2 (MVP):** Joining: an opening card, chapter cards, crossfades, a fade through black between chapters, credits,
  chapter marks in the file.
- **EDIT-3:** Picture-in-picture: a second recorded screen (a phone seat) in a corner instead of a cut.
- **EDIT-4:** Callouts drawn in post: arrows, numbered badges, highlight boxes, by scene.
- **EDIT-5:** Several cuts from one recording: a short (≤ 60 s, vertical), an overview, the full tutorial, each named in
  `film.yaml`.
- **EDIT-6:** Intro and outro templates per brand, with an end card.

### Sound (SOUND)

- **SOUND-1 (MVP):** Narration by a TTS provider, each line cached by its words, model and voice; a throttled request
  waits and retries. MiniMax on Replicate is the first provider.
- **SOUND-2 (MVP):** A score: music cues by scene (a file, or a mood the music library's tags answer), crossfaded, looped
  when a stretch outlasts its track.
- **SOUND-3 (MVP):** Loudness by measurement: the voice and the music each at their own level (voice -16 LUFS, music
  about 17 dB under, ducked further while the narrator speaks), a limiter on the mix, and a check that fails a mix whose
  music-only stretches come within 12 dB of the speech.
- **SOUND-4:** Timing: a scene stretches (holds its last frame, slows a wait) to fit its spoken line, so the narrator
  never runs behind the picture.
- **SOUND-5:** Further voices and providers (a cloned voice of the owner's, others), and loudness presets (YouTube -14,
  embedded -16).
- **SOUND-6:** The music library: a folder of tracks with title, artist, licence and mood tags, and the credits card made
  from the tracks a film used (a CC BY licence asks for it).

### Review (REV)

- **REV-1 (MVP):** `reel review` serves a page per take: for each caption, the frame, the caption and the spoken line;
  approve or flag each scene with a note. Flags are saved beside the take, and `reel record --flagged` retakes those.
- **REV-2 (MVP):** The page plays the finished video with its chapters, and shows the loudness check and the privacy check.
- **REV-3:** Claims in captions checked against the application: a scene may state what must be true when it is shown
  (a selector, a text, or an adapter check such as "this round had a Cleave swing"); a take where it isn't is flagged.
- **REV-4:** A diff between two takes of a scene: the frames side by side, and the application's text that changed.

### Publishing (PUB)

- **PUB-1 (MVP):** A YouTube package: the video, an `.srt` of the narration, chapter timestamps and a description draft
  for the description box, and a thumbnail made from a title card or a chosen frame.
- **PUB-2:** Subtitles per language, and a dubbed narration per language (with FILM-4).

### Keeping films current (KEEP)

- **KEEP-1 (MVP):** A broken step fails with the scene's name and a screenshot, in a dry run as in a real one.
- **KEEP-2:** Re-making a film for a release: record it again, flag the scenes whose frames changed most, re-voice only
  the changed lines (the TTS cache does that already).
- **KEEP-3:** A dry run in CI on each release of the application, failing when a film's steps no longer find their
  elements.

### Studio (STUDIO) (added)

- **STUDIO-1 (MVP):** The studio and the vault: projects → missions → takes as files in `~/reel-studio`, recordings,
  takes and caches in `~/.reel`; a take is a numbered assembly of recorded scenes.
- **STUDIO-2 (MVP):** Project style (voice, languages, music moods, loudness, overlay, cards, transitions, size,
  privacy) inherited by missions, which override it key by key.
- **STUDIO-3 (MVP):** The music library: `reel music scan`, tracks with title, artist, licence, attribution, moods;
  scenes pick music by mood or file; credits from the tracks used.
- **STUDIO-4 (MVP):** The effects library: named transitions, card templates, overlay themes.
- **STUDIO-5 (MVP):** The voices library: named voices with provider, model, voice id and price.
- **STUDIO-6 (MVP):** Reel is generic: an adapter plugin interface (`defineAdapter`), adapters built outside Reel.
- **STUDIO-7 (MVP):** Subtitles per language from written translations, stale ones marked (replaces PUB-2's subtitles).

### Web UI (WEB) (added)

- **WEB-1 (MVP):** `reel serve`: one server on the LAN like Tasker, a JSON API over the same code as the CLI, jobs
  with streamed logs and a per-mission lock shared with the CLI.
- **WEB-2 (MVP):** Studio, project (style form) and mission screens (effective style, YAML scene editor, translations,
  takes, record and make).
- **WEB-3 (MVP):** Library screens: music (play, moods, used by), voices (sample line), effects (previews).
- **WEB-4 (MVP):** Spend: TTS spend by project and mission, and the next run's estimate.

### Other applications (APP) (added, milestone 2)

- **APP-1:** The overlay drawn in post from the timeline, for drivers without a page.
- **APP-2:** A Godot driver: an addon answering steps over a local socket, the window captured by ffmpeg; a Driftward
  mission.

## Constraints

- Node 24 and Playwright (as `delve-video`), ffmpeg on the PATH; the review page needs no build step beyond the tool's own.
- Runs on Linux (the owner's server) and Windows (`delve-video` has a Windows guide); paths and shell calls portable.
- The music is the owner's licensed library (Monument Studios' fantasy tracks in `~/music`, CC BY 4.0): Reel credits
  what it uses and never ships the tracks in its repository.
- TTS costs money: every paid call is cached and counted, and a run says what it would spend before it spends it.
- No secrets in films or in Reel's repository; tokens from the environment or a file outside the film.

## Approaches considered

1. **CLI with a local review page** (chosen by the owner): every step a command, files on disk, a page only for looking
   and approving. Drives well from Claude sessions and CI; the least to build for the review that matters most.
2. **A full web application**, like Tasker: a server with its own UI for writing, recording, reviewing and publishing.
   Friendlier without a terminal, but most of the work would be UI the owner and Claude don't need to make videos.
3. **CLI only**, the review as a generated HTML file: least to build, but approving and flagging scenes would mean
   editing files by hand.

## Migration from delve-video

- `lib/stage.mjs`, the recording fixture, `join.mjs` and `voiceover.mjs` become Reel's recorder, joiner, voice and score.
- `lib/delve.mjs` becomes the Delve adapter.
- The five chapter scripts and the SRD 3.5 chapter become two films (the tour; SRD 3.5) in a `films/` folder of the
  Delve repository or of their own repository, as the owner prefers.
- `delve-video` stays usable until both films record with Reel.

## Left to the builder

The script format's exact syntax (Markdown with fenced steps or YAML), the review page's stack (a small static page with
a JSON API from the CLI is enough), how scenes are cached and keyed, the OCR engine for PRIV-2, and the order of work
after the MVP.
