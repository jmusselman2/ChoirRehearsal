# Rehearsal player: proof of concept

Throwaway single page that tests whether a plain web page can give reliable
Android background playback, lock-screen controls, loop wrap accuracy, offline playback
and follow-along.
The findings carry forward; this code doesn't.

Tap-to-set A–B looping is dropped from the product (see [docs/spec.md](../docs/spec.md)).
The PoC now loops over named ranges from config and measures how cleanly they wrap.

Everything the page needs at runtime is inside `poc/`, so its contents upload as-is.

| File                            | What it is                                                 | In git?             |
| ------------------------------- | ---------------------------------------------------------- | ------------------- |
| `index.html`                    | The PoC page (CSS and JS inline)                           | yes                 |
| `smoke.html`                    | Checkpoint 1: just `<audio controls>` on test1             | yes                 |
| `sw.js`                         | Service worker: offline page and MP3s, with seeking        | yes                 |
| `config.example.js`             | Mock `CONFIG` (titles, loops, lyrics, score sections)      | yes                 |
| `config.js`                     | Your live `CONFIG`, copied from the example                | **no** (gitignored) |
| `mock/score-placeholder.svg`    | Fake score page with 5 empty systems                       | yes                 |
| `mock/artwork.png`              | 512×512 lock-screen artwork (dark tile, steel-blue note)   | yes                 |
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
so Media Session and the service worker work.

**The service worker sticks around.** After the first visit, `sw.js` keeps serving the page
and the saved MP3s. The page, config and images are fetched network-first, so edits still show
up while the server is running. Changed MP3s don't: they're served from the saved copy.
Tap **Remove offline copy** (then reload) to start clean.

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

1. **Titles, artist and album.** Edit `tracks[].title`, `artist` and `album`.
   `artwork` points at `mock/artwork.png` by default.
2. **Score image.** Put the real page image (PNG/JPG/SVG) in `poc/score/`,
   for example `poc/score/test1-p1.png`, and set `follow.test1.score.image`
   to `"score/test1-p1.png"`.
3. **Timing with Mark.** Open `/?follow=1`, play test1,  and tap **Mark** 
   at each lyric line start, then again at each score section (system) start.
   Each tap logs a ready-to-paste `{t: 12.34},`.
   Tap **Copy log** and paste the times into `follow.test1.lyrics[].t`
   and `follow.test1.score.sections[].t`.
4. **Lyric text.** Replace `"Lyric line N"` with the real lines.
5. **Loops.** `loops` is keyed by track id. Each loop is `{name, from, to, note}`,
   with `from` and `to` in seconds of media time.
   Use **Mark** at the loop's start and end to get the times.
6. **Section boxes.** `x`, `y`, `w`, `h` are percentages of the image's
   width and height (top-left origin).
   Measure each system on the real image in any image editor:
   `x = left / imageWidth × 100`, and so on.

`continueToNext` sets what happens when a track ends: `true` (the default) plays the next track,
`false` stops.
The **Continue to next song** checkbox starts from this value and can be flipped while testing.

`album`, `artwork`, `continueToNext` and `loops` are all optional.
An older `config.js` without them still works: no loops, the default album and artwork,
and continue-to-next on.

If `config.js` is missing or broken, the page shows a red banner and the event log says why.
A missing MP3 or score image shows up as an error line in the log.

## Upload to the live site

With cPanel File Manager, upload these files from `poc/` into `public_html/rehearsal/poc/`,
keeping the folder structure.
(`/rehearsal/` itself is reserved for the real app.)

```
index.html
smoke.html
sw.js
config.js
.htaccess
mock/score-placeholder.svg
mock/artwork.png
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
curl.exe -sI -H "Range: bytes=0-1" https://jordanmusselman.com/rehearsal/poc/audio/test1.mp3
```

The response should include `206 Partial Content`, `Accept-Ranges: bytes` and `Content-Type: audio/mpeg`.
A `200` means seeking will be unreliable.
Fix that first.

## Test notes

- The event log is newest first, capped at 200 entries.
  Each line is `wall clock | media time | event`.
  Lines logged while the page was hidden (screen off or another app in front)
  end in `[hidden]`.
- Loops: tap a loop button to jump to its start and play; **Stop** ends it.
  Changing track stops the loop too.
  In the log, A is the loop's start and B is its end:
  - `wrap overshoot +0.xxx s` is a natural wrap at B,
    and shows how far past B playback got before jumping back.
  - `seek past B → A` means you scrubbed past B yourself.
    It isn't an overshoot.
- **−5 s / +5 s** and the lock-screen seek buttons skip 5 s.
  If the system passes its own seek offset, the log shows it and the page uses it.
- **Prev** restarts the track if you're more than 3 s in; otherwise it goes to the previous track.
  **Next** wraps from track 4 to track 1.
  The lock-screen previous/next buttons do the same.
- At the end of a track, playback advances while **Continue to next song** is on (the default),
  and stops after track 4. With it off, playback stops at the end of the track.
  On Android, Chrome removes the media notification once playback stops at the end.
- Lock-screen metadata (title, artist, album, artwork) is set once per track and doesn't change during it.
- **Seek accuracy:** on test1, seek to the same lyric three times and compare the displayed time.
  The files are already CBR, so there's no separate CBR copy.
- Offline:
  - On load the page saves all four MP3s for offline use without asking, then shows
    `Offline: 4/4 songs saved · N MB used`. **Save for offline** re-runs it.
  - Log lines starting `sw:` come from the service worker.
    `audio from cache: test1.mp3 bytes=N- → 206 …` means a seek was answered from the saved file;
    `audio from network` means it wasn't saved yet.
  - To test offline, stop the server (or remove the USB port forward), then reload.
    The page should load, play, seek, loop and switch tracks with every audio line
    reading `from cache`.
