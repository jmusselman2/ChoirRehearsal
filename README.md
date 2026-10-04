# ChoirRehearsal

Practice choir parts anywhere: rehearsal tracks with lyrics and sheet music that follow along.

This README is the project brief. The full design is in [docs/spec.md](docs/spec.md).

## What it is

A phone-first web app (PWA) for practicing the tenor part against rehearsal recordings.
It plays an MP3 and shows the tenor line, the lyrics, or both, synced to the audio.
It's hosted at `jordanmusselman.com/rehearsal/`.

- **Users.** Jordan, plus one tenor friend practicing the same parts. There are no accounts and no login.
- **Content.** 4 songs (Tenor Choir, Fall 2026), each with one MP3, a tenor-only score, and lyrics.
- **Platforms.** Android first, then desktop web (which also runs the Setup screen), then iOS.
  iOS doesn't need every feature.

### Must be true

- Background playback is reliable.
- The app works offline.
- It's one tap from opening the page to playing.

## Key decisions

- **Tenor-only score.** Every notation view shows only the tenor line with lyrics. There's no SATB or full-score view.
- **Tenor rests and the entrance countdown.** During a tenor rest, the measure view holds on the rest and counts down
  the measures until the tenor enters ("Tenor enters in 4").
- **Playback-ordered time map.** Timing is a list of `{ measure, pass }` entries in playback order,
  so a repeated measure appears once per pass. Sections, lyrics and loops all point at `{ measure, pass }`.
- **Per-measure pass and tap offset.** Sections are marked first. A per-measure tapping pass fixes drift where it shows,
  usually at endings and held notes. Each song stores a tap offset that's applied to every tapped mark.
- **Loops are named measure ranges.** The teacher assigns them, and their boundaries are marked in Setup.
  Loops are off by default. There's no tap-to-set A–B looping.
- **Static lock-screen metadata.** Title, artist ("Tenor rehearsal"), album and artwork are set once per track
  and never change during it.
- **No Car Mode.** Lock-screen controls cover eyes-free listening, and Lyrics Only covers a quick glance.
- **⏮/⏭ step between songs**, in the player and on the lock screen. "Continue to next song" only controls
  what happens when a song ends.

## Repo layout

| Path                         | What it is                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| [docs/spec.md](docs/spec.md) | Mockup spec: screens, visual system, sample data, Setup, time map          |
| [poc/](poc/README.md)        | Throwaway proof of concept for background playback, lock screen and loops |

## Status

1. **Proof of concept:** done ([poc/](poc/README.md)). Its findings carry forward; its code doesn't.
2. **Mockup / prototype:** next. See spec §7 for the screens and §14 for the prototype notes.
3. **Real app:** after that.
