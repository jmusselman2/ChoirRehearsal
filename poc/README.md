# Rehearsal player: proof of concept

Throwaway single page that tests whether a plain web page can give reliable
Android background playback, lock-screen controls, A–B looping and follow-along.
The findings carry forward; this code doesn't.

Everything the page needs at runtime is inside `poc/`, so its contents upload as-is.

| File                            | What it is                                                 | In git?             |
| ------------------------------- | ---------------------------------------------------------- | ------------------- |
| `index.html`                    | The PoC page (CSS and JS inline)                           | yes                 |
| `smoke.html`                    | Checkpoint 1: just `<audio controls>` on test1             | yes                 |
| `config.example.js`             | Mock `CONFIG` (titles, lyrics, score sections)             | yes                 |
| `config.js`                     | Your live `CONFIG`, copied from the example                | **no** (gitignored) |
| `mock/score-placeholder.svg`    | Fake score page with 5 empty systems                       | yes                 |
| `score/`                        | Real score images                                          | **no** (gitignored) |
| `audio/test1.mp3` … `test4.mp3` | Copies of the repo-root `audio/` files                     | **no** (gitignored) |
| `sync-media.ps1`                | Copies the MP3s into `poc/audio/`                          | yes                 |
| `.htaccess`                     | `no-cache` for `.html`/`.js`, MIME types for `.mp3`/`.svg` | yes                 |

## Run locally

From the repo root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File poc\sync-media.ps1
if (-not (Test-Path poc\config.js)) { Copy-Item poc\config.example.js poc\config.js }
npx http-server poc -p 8080 -c-1
```

Then open http://localhost:8080/ (player) or http://localhost:8080/?follow=1
(player plus follow-along panel).

Use `http-server`, not `python -m http.server`.
Python's server has no Range support, so seeking breaks.
To confirm Range works locally:

```powershell
curl.exe -sI -H "Range: bytes=0-1" http://localhost:8080/audio/test1.mp3
```

It should return `206 Partial Content`.

**On a phone over USB:** enable USB debugging, open `chrome://inspect` on the PC,
and add port forwarding `8080 → localhost:8080`.
The phone then loads `http://localhost:8080`, which counts as a secure context,
so Media Session works.

## Updating the audio

Rerun the sync script whenever the files in the repo-root `audio/` change:

```powershell
powershell -ExecutionPolicy Bypass -File poc\sync-media.ps1
```

It copies `audio/test1.mp3` … `test4.mp3` into `poc/audio/`.
There's no re-encode: the originals are already 192 kbps CBR.

## Replacing the mocks

All song-specific values live in `poc/config.js`.
Every mock value is marked `// TODO: replace`.
Edit `config.js`, not the example, because real lyrics must stay out of the public repo.

1. **Titles and artist.** Edit `tracks[].title` and `artist`.
2. **Score image.** Put the real page image (PNG/JPG/SVG) in `poc/score/`,
   for example `poc/score/test1-p1.png`, and set `follow.test1.score.image`
   to `"score/test1-p1.png"`.
3. **Timing with Mark.** Open `/?follow=1`, play test1,  and tap **Mark** 
   at each lyric line start, then again at each score section (system) start.
   Each tap logs a ready-to-paste `{t: 12.34},`.
   Tap **Copy log** and paste the times into `follow.test1.lyrics[].t`
   and `follow.test1.score.sections[].t`.
4. **Lyric text.** Replace `"Lyric line N"` with the real lines.
5. **Section boxes.** `x`, `y`, `w`, `h` are percentages of the image's
   width and height (top-left origin).
   Measure each system on the real image in any image editor:
   `x = left / imageWidth × 100`, and so on.

If `config.js` is missing or broken, the page shows a red banner and the event log says why.
A missing MP3 or score image shows up as an error line in the log.

## Upload to the live site

With cPanel File Manager, upload these files from `poc/` into `public_html/rehearsal/`,
keeping the folder structure:

```
index.html
smoke.html
config.js
.htaccess
mock/score-placeholder.svg
audio/test1.mp3
audio/test2.mp3
audio/test3.mp3
audio/test4.mp3
score/…            (only once you have a real score image)
```

`config.example.js`, `sync-media.ps1` and this README aren't needed on the server.
Uploading them is harmless.

`.htaccess` is a dotfile, so File Manager hides it by default.
Turn on *Settings → Show Hidden Files* to check that it's there.

Then check Range support on the live server:

```powershell
curl.exe -sI -H "Range: bytes=0-1" https://jordanmusselman.com/rehearsal/audio/test1.mp3
```

The response should include `206 Partial Content`, `Accept-Ranges: bytes` and `Content-Type: audio/mpeg`.
A `200` means seeking will be unreliable.
Fix that first.

## Test notes

- The event log is newest first, capped at 200 entries.
  Each line is `wall clock | media time | event`.
  Lines logged while the page was hidden (screen off or another app in front)
  end in `[hidden]`.
- Loop lines:
  - `wrap overshoot +0.xxx s` is a natural wrap at B,
    and shows how far past B playback got before jumping back.
  - `seek past B → A` means you scrubbed past B yourself.
    It isn't an overshoot.
- **Prev** restarts the track if you're more than 3 s in; otherwise it goes to the previous track.
  **Next** wraps from track 4 to track 1.
  Auto-advance at the end of a track stops after track 4.
- **Row 8 (seek accuracy)** is a seek-consistency check on test1 only.
  Seek to the same lyric three times and compare the displayed time.
  The files are already CBR, so there's no separate CBR copy.
