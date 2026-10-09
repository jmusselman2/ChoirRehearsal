# ChoirRehearsal

Practice choir parts anywhere: rehearsal tracks with lyrics and sheet music that follow along.

This README is the project brief. The full design is in [docs/spec.md](docs/spec.md).

## What it is

A phone-first web app (PWA) for practicing the tenor part against rehearsal recordings.
It plays an MP3 and shows the tenor line, the lyrics, or both, synced to the audio.
It's hosted at `jordanmusselman.com/rehearsal/`.

- **Users.** Jordan, plus one tenor friend practicing the same parts. There are no accounts and no login.
- **Content.** 4 songs (Tenor Choir, Fall 2026), each with one MP3, a tenor-only score, and lyrics.
- **Platforms.** Android first, then desktop web (which also runs the setup page), then iOS.
  iOS doesn't need every feature.

### Must be true

- Background playback is reliable.
- The app works offline.
- It's one tap from opening the page to playing.

## Key decisions

- **Tenor-only score.** Every notation view shows only the tenor line with lyrics. There's no SATB or full-score view.
- **Tenor rests and the entrance countdown.** During a tenor rest, the measure view holds on the rest and counts down
  the measures until the tenor enters ("Tenor enters in 4").
- **Everything is keyed by printed measure number.** Sections, lyric phrases, rests and loops all point at measures
  (a pickup is m. 0). Timing is a set of measure anchors with even spacing in between.
  None of the songs has a written repeat, so a measure number alone identifies a point in time.
- **Section marks first, per-measure marks only where needed.** A per-measure pass fixes drift at endings,
  held notes and re-entries after rests.
- **Loops are named measure ranges** the teacher assigns. Off by default; no tap-to-set A–B looping.
- **⏮/⏭ step between songs** and wrap. A **Repeat** setting (Off / This song / All songs) decides what happens
  when a song ends; Off plays through to the end of the last song.
- **Static lock-screen metadata.** Title, artist ("Tenor rehearsal"), album and artwork are set once per track.
- **Offline is automatic.** All four songs are saved after the first load; there's no download button.
- **No Car Mode.** Lock-screen controls cover eyes-free listening, and the Lyrics view covers a quick glance.
- **Landscape by default.** Force landscape starts on. It can be disabled in Settings to
  follow the phone orientation; if a browser denies the runtime lock, the music remains visible
  and the setting turns itself off, ready to be turned on from Settings.
- **Scores are MusicXML**, rendered with OpenSheetMusicDisplay. Measure is the default view: the ribbon
  scrolls continuously under a fixed playhead. The staff grows to fill the screen: portrait shows
  about 2–3 measures with the next line below, and landscape runs edge to edge with the playhead a
  third of the way in.
- **Plain HTML and JavaScript.** No build step and no framework.

## Repo layout

| Path                         | What it is                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------- |
| [docs/spec.md](docs/spec.md) | The spec: screens, behavior, timing model, data, offline, phases, tests      |
| [poc/](poc/README.md)        | Throwaway proof of concept: background playback, lock screen, loops, offline |
| `app/`                       | The real app. Everything under it uploads as-is to `/rehearsal/`             |
| `app/content/`               | Real songs, scores and lyrics. Gitignored, because they're copyrighted       |
| `app/content.example/`       | Placeholder Song One–Four (spec §10), used when `app/content/` is missing   |
| `app/vendor/`                | OpenSheetMusicDisplay 2.2.0, vendored with its licenses (no CDN)            |
| `tests/`                     | `node:test` unit tests for the timing, loop, playback, content and settings core |
| `tools/`                     | `generate-sample-content.mjs`, which builds `app/content.example/`           |

## Run it locally

From the repo root:

```powershell
npx http-server app -p 8080 -c-1
```

Then open http://localhost:8080/. Use `http-server` rather than Python's server, which has no
Range support, so seeking breaks. The player loads `app/content/catalog.json`; when that file
doesn't exist (a 404, as in a fresh clone) it loads the placeholder songs from
`app/content.example/` instead and shows **Sample songs** in the Settings footer. Any other
failure (a server or permission error, malformed JSON, a catalog that fails validation) shows an
error with Retry rather than falling back.

Every URL inside `app/` is relative, so the same files work at `/` locally and at `/rehearsal/`
on the live site. On a phone, forward port 8080 from `chrome://inspect`; `localhost` counts as a
secure context, so Media Session works.

## Timing a song (setup page)

With the server running, open http://localhost:8080/setup/ on a desktop. It loads the same catalog
as the player (`app/content/`, or the samples on a 404).

1. Pick a song, press play, and tap **Mark** (or Space) as each section begins.
2. Watch the preview and the boundary strip: solid lines are marked, dotted ones inferred.
3. Where it drifts (endings, held notes, tenor re-entries), switch to **Measures**, enter a range
   such as m. 81 to m. 88, and mark each measure; **Skip measure** passes over long rests.
4. Fix single marks with −0.1 / +0.1, **Re-mark** or **Undo** (Ctrl+Z).
5. Check the proposed rests and lyric phrases, add any loops, then **Download JSON** and replace
   the song's file in `app/content/songs/`.

Work in progress is saved in the browser per song until you discard it. The tool never writes
files itself.

## Offline and updates

After the first visit the player saves every song automatically (Settings shows
`Saving for offline… 2 of 4`, then `✓ Available offline · 4 songs`) and the service worker
(`app/sw.js`) serves it from the next launch, including seeking in saved audio.

- Bump `APP_VERSION` in `app/sw.js` whenever code changes, so phones fetch the new app files.
- Bump `catalogRevision` in `app/content/catalog.json` whenever content changes. Phones download
  the new revision in the background and switch to it on their next launch, never mid-song.
- On `localhost` the worker fetches app files network-first, so edits show up on reload. To start
  completely fresh, clear the site's data in the browser.

## Tests

```powershell
node --test tests
```

No dependencies or install step. The tests import the same modules the player uses from `app/js/`.

## Sample content

`app/content.example/` is generated and committed. Its songs, lyrics, MusicXML and audio are
original placeholders: the audio is one short tone at the start of every printed measure, placed
by `app/js/timing.js`, so sync, the rest countdown, loops and Repeat can be checked without the
copyrighted recordings. To rebuild it (the MP3s need `ffmpeg` with libmp3lame; the player never does):

```powershell
node tools/generate-sample-content.mjs
```

The output is deterministic. `--no-audio` rebuilds only the JSON and MusicXML.

## Status

1. **Proof of concept:** background playback, lock-screen controls, metadata, artwork, loop wrapping
   and offline playback with seeking, all verified on a Pixel 7, in a Chrome tab and as an installed app.
   Keep-screen-on works there too, and OpenSheetMusicDisplay was chosen as the MusicXML renderer (spec §17).
2. **Clickable prototype:** done and Pixel-reviewed (`New folder/`, see spec §21).
3. **Player:** the production shell, sample content, playback/timing/settings core and the score,
   lyrics, measure and whole-score views are built (finishing guide steps 3–5).
4. **Setup page:** marking, nudges, per-measure passes, rest and phrase proposals, loops,
   validation and JSON export (step 6).
5. **Offline and install:** service worker, per-revision content caches, cached Range requests and
   the Settings status line (step 8). Next: timing the real songs on the setup page, then
   device QA and deployment.
