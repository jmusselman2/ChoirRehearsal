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
- **Plain HTML and JavaScript.** No build step and no framework.

## Repo layout

| Path                         | What it is                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------ |
| [docs/spec.md](docs/spec.md) | The spec: screens, behavior, timing model, data, offline, phases, tests        |
| [poc/](poc/README.md)        | Throwaway proof of concept: background playback, lock screen, loops, offline  |
| `app/` (planned)             | The real app. Everything under it uploads as-is to `/rehearsal/`              |
| `app/content/`               | Real songs, scores and lyrics. Gitignored, because they're copyrighted        |

## Status

1. **Proof of concept:** background playback, lock-screen controls, metadata, artwork, loop wrapping
   and offline playback with seeking, all verified on a Pixel 7, in a Chrome tab and as an installed app.
2. **Clickable prototype:** next. See spec §21.
3. **Real app:** after that.
