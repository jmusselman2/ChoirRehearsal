# Choir Rehearsal Player: Spec

Oct 8, 2026 · Jordan

This is the single spec for the real app. It merges two earlier documents and records the decisions made on Oct 8:

- **Screens and UI** come from the Oct 3 mockup spec (and its review).
- **Data, timing engine, offline, playback rules and testing** come from the longer project spec.
- Where the two disagreed, the Oct 8 decision is what's written here. §20 lists what's still open.

The repo is public, so this spec uses placeholder song titles and lyrics. Real song data lives in the gitignored `app/content/` folder (§15).

---

## 1. What this is

A phone-first web app (PWA) for practicing choir parts against rehearsal recordings. It plays an MP3 and shows the tenor line, the lyrics, or both, synced to the audio.

- **Users.** Jordan first, plus one tenor friend practicing the same parts. No accounts and no login.
- **Content.** 4 songs (Tenor Choir, Fall 2026). Each song has one MP3, a tenor-only score, and lyrics.
- **Platforms.** Android is the priority, then desktop web (which also runs the setup page), then iOS. iOS doesn't need every feature.
- **Hosting.** `jordanmusselman.com/rehearsal/`, open to anyone with the URL. The proof of concept moves to `/rehearsal/poc/`.
- **Must be true.** Background playback is reliable, the app works offline, and there's one tap from opening the page to playing.

## 2. Settled decisions

These are fixed. Don't redesign around them.

| Decision | Consequence |
|---|---|
| **Straight into the action** | The app opens on the player, on the last song used, at 0:00, paused and ready to play. No library, menu, or download step. |
| **Score is tenor-only** | Every notation view shows only the tenor line with lyrics. No SATB or full-system view anywhere. |
| **Audio is tenor-prominent** | Full-choir recordings with the tenor brought forward. Tempo varies, with ritardandos, fermatas, and held notes. |
| **Score format** | Songs start as page images with section boxes, then move to MusicXML song by song. Everything is keyed by measure number, so data carries over between formats. |
| **Measure numbers are printed numbers** | Numbers match the printed score and continue through rests. A pickup measure is m. 0. None of the four songs has a written repeat, so a measure number alone identifies a point in time. |
| **Loops are secondary** | Off by default. A loop is a named measure range assigned by Jordan's teacher. No tap-to-set A–B. Songs ship with no loops; they're added later. |
| **Accent is a muted steel blue** | Used only for the current position, the progress bar, the play button ring, and active toggles. Loop shading is neutral grey. |
| **⏮/⏭ step between songs** | Not sections. ⏭ on the last song wraps to the first. |
| **Repeat setting** | Off (plays through to the end of the last song, then stops), This song, or All songs. Default Off. |
| **Song changes start playing** | Picking a song, or ⏮/⏭, starts the new song from 0:00. |
| **No Car Mode** | Lock-screen controls cover eyes-free listening; Lyrics view covers a quick glance. |
| **Static lock screen** | Title, "Tenor rehearsal", album and artwork, set once per track. Never updated live. |
| **No left-side header chevron** | There's nothing to go back to. |
| **Measure view needs MusicXML** | Page-image songs show Measure disabled with a reason. |
| **Whole Score opens from the view menu** | A separate browse screen, not one of the synced view modes. |
| **Plain HTML and JavaScript** | No build step, no framework. ES modules served as files (§17). |

### Out of scope

A library or home screen, a download button, SATB or full-score views, Car Mode, A–B tap looping, loop lead-ins or count-ins, a tap-offset calibration, a gold accent, the left header chevron, live section text on the lock screen, login or accounts, automatic score following, and score editing in the setup page.

---

## 3. Visual system

### Canvas

- **Primary frame:** 412 × 915 dp (a typical Android phone). Check every phone screen at **360 dp wide** too.
- **Desktop frame** (setup page only): 1440 × 900.
- **Theme:** dark UI. Notation always sits on a light "paper" card, because score images are black on white.

### Color tokens

These are starting values. The final palette is chosen when the prototype is on the phone (§20). The project spec's alternative was `#111315` background with a `#627d90` accent.

| Token | Value | Use |
|---|---|---|
| `bg` | `#121417` | App background |
| `surface` | `#1B1F24` | Player bar, sheets, header |
| `surface-2` | `#242A31` | Chips, list rows, banner |
| `divider` | `#2E353D` | Hairlines |
| `text` | `#E8EAED` | Primary text |
| `text-2` | `#A3ABB5` | Secondary text, timestamps |
| `text-3` | `#6B7380` | Dimmed lyrics, disabled |
| `paper` | `#F7F5F0` | Notation card background |
| `ink` | `#1A1A1A` | Notation |
| `ink-faded` | `#1A1A1A` at 35% | Faded next line, upcoming entrance measure |
| `accent` | `#6E8FB3` | Muted steel blue (see uses below) |
| `accent-tint` | `#6E8FB3` at 18% | Current-measure highlight on paper |
| `loop-band` | `#A3ABB5` at 22% | Loop range shading (neutral on purpose) |

**Accent appears only on:** the current-position marker (ribbon playhead, current-measure tint, lyrics left marker, current-song bar in Switch Song), the played part of the scrub bar, the play button ring, and toggles that are on. Everything else stays neutral, including loop shading and the loop banner.

### Type

Use the system font (Roboto on Android).

| Role | Size / weight |
|---|---|
| Header title | 17 / 600 |
| Body, list rows | 15 / 400 |
| Secondary, timestamps | 13 / 400, `text-2` |
| Chip label | 13 / 500 |
| Lyrics: current section | 22 / 500 (A−/A+ steps: 18, 20, 22, 26, 30) |
| Lyrics: neighbors | 17 / 400, `text-3` |
| Countdown ("Tenor enters in 4") | 15 / 600, `ink` on paper |
| Measure numbers on ribbon | 11 / 500, `text-2` on paper |

### Shape, spacing and motion

- Spacing scale: 4 / 8 / 12 / 16 / 24. Side gutter: 16 dp.
- Touch targets: at least 48 dp.
- Corner radius: 12 dp for cards and paper, 20 dp for the top corners of sheets, full pill for chips.
- Sheets slide up from the bottom over a 50% black scrim, with a grab handle at the top.
- Respect Android safe areas. Notation and lyrics never hide under the player bar.
- Honor `prefers-reduced-motion`: no animated scrolling, simple fades only. Playback never waits for an animation.

---

## 4. Persistent layout (phone)

From top to bottom:

1. **Status bar**, 24 dp.
2. **Header**, 56 dp, on `surface`.
   - Left: an empty spacer the same width as the right icons, so the title stays centered.
   - Center: the song title plus a small ⌄. Tapping it opens **Switch Song**. Long titles truncate with an ellipsis.
   - Right: a ⚙ settings icon. Tapping it opens **Settings**.
3. **Practice loop banner** (only while a loop is active): 44 dp on `surface-2`. "Loop · Bridge entrance · m. 55–60" and an × that stops the loop (the Loops setting stays on).
4. **Content area.** Depends on the view mode (§5).
5. **Player bar**, about 196 dp, on `surface`:
   - **Chip row**, 36 dp chips, left-aligned with 8 dp gaps:
     - Speed chip: `1.0×`. Opens a small speed sheet with the same slider as Settings.
     - View-mode chip: `Score + Lyrics ▾`.
     - Loop chip: `⟲ Loops`, or `⟲ Bridge entrance` while a loop is active. Shown only when Loops is on in Settings.
   - **Scrub bar** with elapsed time on the left and remaining time on the right. The played portion is `accent`. Section starts are small ticks. An active loop's range shows as a `loop-band` block.
   - **Transport**, centered: −5 · ⏮ · ▶ · ⏭ · +5. Play/pause is a 64 dp circle with a 2 dp `accent` ring. The other buttons are 48 dp.
     - ⏮ restarts the current song if playback is more than 3 s in; otherwise it goes to the previous song. ⏭ goes to the next song, wrapping from the last to the first.
     - The new song starts playing from 0:00.

**Check at 360 dp:** all three chips fit on one row. If they don't, the view-mode chip drops the ▾ and shortens "Score + Lyrics" to "Score+Lyr". Never wrap to a second row.

---

## 5. View modes

The view-mode chip opens a small menu:

```
  Score
  Lyrics
• Score + Lyrics
  Measure           (disabled: "Needs MusicXML" on page-image songs)
  ─────────────
  Whole score →
```

The choice persists across launches and song changes. If the saved view is Measure and the new song has no MusicXML, show Score + Lyrics with a one-line note.

- **Score.** A paper card showing the current section of the tenor score. For page-image songs, this is a crop of the section box; for MusicXML songs, the matching tenor system(s). When the section changes, the card cross-fades. A thin `accent` bar on the card's left edge marks it as current.
- **Lyrics.** A vertical list of sections, each made of lyric phrases (§14):
  - The current section is centered, with a 3 dp `accent` left marker. Its current phrase is bright (22 / 500); its other phrases are `text-2`.
  - The sections before and after are dimmed (`text-3`).
  - The section name sits above each block in small caps, `text-2`.
  - A− and A+ sit on the right of the header, just left of ⚙. The left spacer widens to match, so the title stays centered.
  - The list scrolls itself. If the user scrolls manually, auto-follow pauses until they tap "Follow" (a small pill at the bottom of the list).
  - During a rest with no current phrase, the next phrase shows dimmed with the countdown.
- **Score + Lyrics** (the default view). The paper card holds the current section and takes about 55% of the content area. Below it, the current phrase at 20 / 500, with the next phrase dimmed.
  - No lyrics for this section: the score expands and "Lyrics unavailable for this section" shows in `text-3`.
  - The score can't render: playback continues, the lyrics show, and "Score unavailable" with a Retry button replaces the card.
- **Measure** (Measure Follow-Along). The measure ribbon (§6), with the current section name and lyric line below it. MusicXML songs only.
- **Whole score.** A full-screen browse view: the tenor pages scrolled vertically, with no sync and no auto-scroll. The header shows "Whole score" and an × that returns to the player. A compact bar at the bottom (play/pause, title, elapsed time) keeps playback controllable. A small "Jump to current section" button appears after scrolling away from it.

---

## 6. Measure ribbon

The ribbon is the main screen once MusicXML exists, so it has to be large.

- **Size.** A paper card about 300 dp tall (roughly a third of the screen):
  - The **current line**, about 190 dp, shows **4–5 measures** of the tenor staff with lyrics under the notes.
  - The **next line**, about 90 dp, below at `ink-faded`.
- **Staff.** One tenor staff, in the clef the printed score uses for the tenor line (§13).
- **Position.** The current measure gets an `accent-tint` fill. A 2 dp `accent` playhead marks the exact position. Measure numbers sit above the staff.
- **Motion: build both, decide on the phone.**
  - **Line paging:** the playhead moves across the line; when the last measure ends, the next line slides up and becomes current, like reading sheet music.
  - **Continuous:** the playhead is fixed at the center and the music scrolls under it.
- **Tenor rests and countdown.** When the current measure falls inside a rest range (§13):
  - The ribbon holds on the rest. A multi-measure rest shows as one wide bar with its count above it (for example, "8").
  - A label above the staff reads **"Tenor enters in 4"**. The number is **measures** remaining before the entrance, and it counts down at each barline. Scrubbing into a rest computes it immediately; pausing freezes it.
  - The entrance measure shows faded to the right of the rest. On the last measure before the entrance ("enters in 1"), it brightens to full `ink`.
  - At the entrance, the ribbon goes back to normal motion, with the entrance measure current.
- **Loop active.** The loop's measures get a `loop-band` fill behind the staff. Its start and end barlines are drawn 2 dp thicker.

---

## 7. Screens and states to draw

Phone frames are 412 × 915 and use the sample data in §10.

1. **Player, Score + Lyrics:** Song 1, Verse 1, paused at 0:41. The loop chip is hidden.
2. **Switch Song** sheet: a compact list of the 4 songs (title plus duration). The current song is marked with a 3 dp `accent` bar on the left. No other buttons.
3. **Measure Follow-Along**, normal: Song 1, m. 18 (Verse 1). The current line and the faded next line.
4. **Measure Follow-Along, rest countdown:** Song 1, m. 52 during the 8-measure interlude rest. "Tenor enters in 5", with m. 57 faded at the right.
5. **Lyrics:** the Chorus is current, with Verse 2 above it and the Interlude below, both dimmed. A−/A+ in the header.
6. **View-mode menu** open on a page-image song (Song 2), so Measure is disabled with "Needs MusicXML".
7. **Whole score** browse view.
8. **Settings** sheet (§8), with Loops **on** and Song 1's loops listed.
9. **Loop list** sheet, opened from the loop chip (§9).
10. **Practice Loop Active:** Measure view on Song 1 with "Bridge entrance" (m. 55–60) active. Show the banner, the shaded range on the ribbon (covering the end of the rest and the re-entry), the range on the scrub bar, and the loop chip showing the loop name.
11. **Lock screen / media notification** (Android): song title, "Tenor rehearsal", the artwork (a dark tile with a steel-blue note), and prev / play-pause / next with the system seek bar. Android 16 draws the artwork as the card's background.
12. **Song without timing yet** (Song 4): the lyrics show as a static scrolling list with a subtle notice, "Timing not set — not synced". The audio still plays normally.
13. **Setup page** (desktop, §16): marking section starts, and a per-measure pass on m. 81–88.

### Back gesture (annotate on frames 2, 6, 8, 9)

Android back closes the open sheet or menu and nothing more. From the player with nothing open, back leaves the app as normal. Each sheet pushes a history entry when it opens.

---

## 8. Settings sheet

A bottom sheet with three groups and a footer.

- **Playback**
  - Speed: a slider from `0.5×` to `1.5×` in `0.1×` steps, default `1.0×`. "Pitch kept" underneath.
  - Skip interval: 5 s (fixed; shown read-only).
  - Repeat: `Off` · `This song` · `All songs`, default Off. Help line for Off: "Plays through to the end of the last song, then stops."
- **Display**
  - View mode: Score / Lyrics / Score + Lyrics / Measure (Measure disabled on page-image songs).
  - Lyrics size: A− · 22 · A+.
  - Keep screen on while playing: toggle, on.
- **Practice loops**
  - Show loops: toggle, off by default. When it's on, the loop chip appears in the player bar.
  - When it's on, the current song's loops are listed below the toggle, in the same row style as the loop list (§9). Tapping one starts it and closes the sheet.
  - A song with no loops: "No loops for this song yet."
  - Help line: "Loops are assigned by your teacher."
  - Turning the toggle off stops any active loop and hides the chip, but remembers the selected loop.
- **Footer:** the offline status line (§19) in `text-2`, then the credit line in `text-3`.

## 9. Loop list sheet

A short sheet titled "Practice loops — Song One", opened from the loop chip.

Each row shows the loop name (15 / 500), the range in `text-2` (for example, "m. 55–60 · 0:17"), and an optional teacher note on a second line in `text-3`. Tapping a row starts the loop and closes the sheet. The active loop's row has an `accent` left bar and a "Stop" text button. A song with no loops shows "No loops for this song yet."

### Loop behavior

- **Boundaries.** A loop is an inclusive measure range. Its start time is the start of its first measure; its end time is the start of the measure after its last one, or the song's end when the loop ends on the final measure.
- **Starting.** Selecting a loop seeks to its start (unless playback is already inside it) and plays.
- **Wrapping.** Reaching the end time seeks to the exact start. Detection uses frequent `timeupdate` checks, not one long timer, and stays correct at every speed. (The PoC measured wrap overshoot of about 0.14–0.18 s on the Pixel 7, screen on or off.)
- **Seeking outside.** Allowed. A seek or skip that lands outside the loop suspends it until the next Play, which jumps back to the loop start.
- **Relaunch.** The selected loop per song is remembered, but the app reopens with no loop running.
- **Repeat setting.** An active loop wins over Repeat.

---

## 10. Sample data (use this in every frame)

Lyrics are original placeholder text. Don't substitute real lyrics.

**Songs**

| # | Title (placeholder) | Length | Score format | Timing |
|---|---|---|---|---|
| 1 | Song One | 4:18 | MusicXML | Sections and per-measure marks |
| 2 | Song Two | 3:05 | Page images (starts with a pickup, m. 0) | Sections |
| 3 | Song Three | 2:47 | Page images | Sections |
| 4 | Song Four | 3:32 | Page images | Not set |

**Song 1 structure** (4/4, about 84 bpm, so a measure lasts 2.857 s)

| Section | Measures | Starts | Tenor |
|---|---|---|---|
| Intro | 1–8 | 0:00 | Rest (8 measures) |
| Verse 1 | 9–24 | 0:23 | Sings |
| Verse 2 | 25–40 | 1:09 | Sings |
| Chorus | 41–48 | 1:54 | Sings |
| Interlude | 49–56 | 2:17 | Rest (8 measures) |
| Bridge | 57–72 | 2:40 | Sings (enters m. 57) |
| Final chorus | 73–84 | 3:26 | Sings |
| Ending | 85–88 | 4:00 | Sings; ritardando, fermata on m. 87 |

**Song 1 loops**

- **Bridge entrance**, m. 55–60. Note: "Count the rest, come in clean on 57."
- **Final hold**, m. 83–88. Note: "Hold through the fermata, watch the cutoff."

**Placeholder lyric phrases**

| Section | Measures | Phrase |
|---|---|---|
| Verse 1 | 9–16 | Morning comes across the river, |
| Verse 1 | 17–24 | every lantern burning low. |
| Verse 2 | 25–32 | Evening falls along the meadow, |
| Verse 2 | 33–40 | every field is turning gold. |
| Chorus | 41–44 | Carry me home, carry me home, |
| Chorus | 45–48 | over the hill where the tall grass grows. |
| Bridge | 57–64 | Long is the road, |
| Bridge | 65–72 | but the light remains. |
| Final chorus | 73–84 | Carry me home, carry me home. |
| Ending | 85–88 | Home. |

---

## 11. Playback behavior

### Engine

- Exactly one `<audio>` element, behind one playback module that owns the state.
- `audio.currentTime` is the only clock. Musical position is never derived from animation frames or wall-clock time.
- Views update with `requestAnimationFrame` while visible and from `timeupdate` while hidden.
- Speed: `playbackRate` 0.5–1.5 with `preservesPitch` on. Set both `playbackRate` and `defaultPlaybackRate` after every `src` change (the PoC found the load algorithm resets them).

### Commands

| Command | Behavior |
|---|---|
| Play | Start at the current position. At the end, seek to 0 first. With a suspended loop, jump to the loop start. |
| Pause | Stop without changing position. |
| Seek | Clamp to the song. Update the musical position immediately. |
| Skip | ±5 s, then clamp to the song. |
| ⏮ | Restart if more than 3 s in; otherwise the previous song (wrapping). |
| ⏭ | The next song (wrapping). |
| Song change | From the sheet, ⏮/⏭ or the lock screen: load the new song at 0:00 and play. Any active loop stops. |
| End of song | Repeat Off: play the next song, stopping after the last. This song: restart. All songs: play the next song, wrapping. |

### Launch and persistence

- Launch opens the last song at 0:00, paused. Never autoplay.
- Persisted (in `localStorage`, small enough not to need IndexedDB): last song, view mode, speed, lyrics size, Repeat, Keep screen on, the Loops toggle, and the selected loop per song.
- Playback position is **not** persisted: every song starts at 0:00.
- A missing or corrupt stored state falls back to defaults.

### Interruptions

- On a phone call or competing audio, follow the platform and show the real paused state. Never resume automatically.
- After returning to the foreground, re-read state from the audio element.
- Keep screen on uses the Screen Wake Lock API while playing, re-requested when the page becomes visible.

---

## 12. Timing model

### Concepts

- A **measure** is the printed measure number (m. 0 for a pickup). Numbers continue through tenor rests.
- A **section** is a named inclusive measure range with a required start-time anchor.
- A **timing anchor** is an explicit timestamp for the start of a measure.
- An **inferred boundary** is a measure start calculated between two anchors.

### Required anchors

- The first measure, at its audible start.
- The first measure of every section.
- A **terminal** anchor: the song duration, assigned to the measure after the last one.
- Extra anchors wherever drift is visible, especially ritardandos, fermatas, held endings, and the measure where the tenor re-enters after a rest.

### Interpolation

Between anchors at measures `a` and `b` (times `tA`, `tB`), for `a < m < b`:

```text
uniform:        time(m) = tA + ((m − a) / (b − a)) × (tB − tA)
notated beats:  time(m) = tA + (beats from a to m / beats from a to b) × (tB − tA)
```

Notated beats is available for MusicXML songs (it handles time-signature changes). Explicit anchors always win. Interpolation is only for display; audio is never stretched.

### Runtime lookup

- When a song loads, precompute a sorted boundary table for every measure, each marked explicit or inferred.
- Find the current measure by binary search for the last boundary ≤ `currentTime`.
- Derive the current section, phrase, rest and loop from the measure. Views never compute timing themselves; they ask the timing module.

### Accuracy targets

- Anchors are stored to 0.01 s; the setup page shows tenths.
- Section changes: within ±250 ms of the audible event.
- Measure changes in refined passages: within ±200 ms, or ±100 ms where a loop boundary depends on it.

### Validation (checked when a song loads, and by the setup page)

- Anchor measures and times strictly increase; anchors lie within the audio's duration.
- Sections don't overlap and cover the song's measures (a gap is a warning).
- Lyric phrases don't overlap.
- Rest ranges don't overlap, and each entrance measure comes after its rest (unless the rest runs to the end).
- Every loop lies within known measures.
- Referenced files exist. The declared duration matches the decoded audio within 1 s.
- A song that fails validation still plays its audio; the synced views show "Timing not set — not synced".

---

## 13. Tenor score

### Page images (interim format)

- Ordered page images.
- Section regions: rectangles normalized to the page (`x`, `y`, `width`, `height` in 0–1), each with its measure range.
- Score and Score + Lyrics use the section regions. Whole Score shows complete pages.
- No Measure view (no per-measure regions in v1).

### MusicXML

- Render only the tenor part. Keep printed measure numbers (including m. 0), key and time signatures, lyrics and multi-measure rests.
- **Clef:** the clef the printed score uses for the tenor line, taken from the MusicXML. The renderer never overrides it.
  - In the first song's printed score the tenors share a bass-clef staff with the basses, so its tenor line shows in bass clef, with ledger lines for the high notes.
  - A score that prints the tenor part on its own staff in treble clef with an 8 below shows that instead.
  - If the printed tenor line changes clef partway, the MusicXML carries the change.
- **Divided tenors:** show the line the recording features. For one song the recording is Tenor 2 predominant, so its score shows the Tenor 2 line. The song file names the line (`score.line`, §15).
- Measure view lays out its own ribbon, independent of page rendering.
- If a future song has repeats, flatten them to playback order when preparing the content.

### Rest ranges

Rest ranges are stored explicitly, even when MusicXML could imply them, because they drive the countdown:

- start and end measure (inclusive);
- entrance measure, normally end + 1;
- an optional label.

The setup page can propose rest ranges from MusicXML (measures with no pitched notes); a person confirms them.

---

## 14. Lyrics

- Lyrics are **phrases**, grouped by section. Each phrase covers an inclusive measure range; optional exact start/end times override the measure timing.
- The current phrase is the one whose range contains the current measure. Rests may have no current phrase.
- MusicXML syllables feed Measure view; the curated phrases feed Lyrics and Score + Lyrics.
- Punctuation, capitalization, apostrophes and hyphenation are kept as written.

---

## 15. Content and data

### Where content lives

The arrangements and recordings are copyrighted and the repo is public:

- **`app/content/`** (gitignored) holds the real catalog, song files, audio, score images and MusicXML. It's uploaded with the rest of `app/` (§17).
- **`app/content.example/`** (in git) holds the placeholder Song One–Four from §10, so the app runs without real content.
- The player loads `content/catalog.json`. If that's missing (a 404), it loads `content.example/catalog.json` instead and shows "Sample songs" in the Settings footer. The setup page does the same with `../content/`.

```text
app/content/
├── catalog.json
├── songs/song-1.json …
├── audio/song-1.mp3 …
└── score/song-1.musicxml, song-2/page-1.webp …
```

### Catalog

```json
{
  "catalogRevision": "2026-10-08.1",
  "album": "Tenor Choir · Fall 2026",
  "songs": [
    { "id": "song-1", "src": "songs/song-1.json" },
    { "id": "song-2", "src": "songs/song-2.json" },
    { "id": "song-3", "src": "songs/song-3.json" },
    { "id": "song-4", "src": "songs/song-4.json" }
  ]
}
```

The array order is the song order.

### Song file

```json
{
  "id": "song-1",
  "title": "Song One",
  "durationSeconds": 258.0,
  "measures": { "first": 1, "last": 88 },
  "audio": "audio/song-1.mp3",
  "score": { "format": "musicxml", "src": "score/song-1.musicxml", "partId": "P1" },
  "sections": [
    { "id": "intro", "label": "Intro", "from": 1, "to": 8 },
    { "id": "verse-1", "label": "Verse 1", "from": 9, "to": 24 },
    { "id": "verse-2", "label": "Verse 2", "from": 25, "to": 40 },
    { "id": "chorus", "label": "Chorus", "from": 41, "to": 48 },
    { "id": "interlude", "label": "Interlude", "from": 49, "to": 56 },
    { "id": "bridge", "label": "Bridge", "from": 57, "to": 72 },
    { "id": "final-chorus", "label": "Final chorus", "from": 73, "to": 84 },
    { "id": "ending", "label": "Ending", "from": 85, "to": 88 }
  ],
  "timing": {
    "interpolation": "uniform",
    "anchors": [
      { "measure": 1,  "time": 0.00,   "source": "section" },
      { "measure": 9,  "time": 22.86,  "source": "section" },
      { "measure": 25, "time": 68.57,  "source": "section" },
      { "measure": 41, "time": 114.29, "source": "section" },
      { "measure": 49, "time": 137.14, "source": "section" },
      { "measure": 57, "time": 160.00, "source": "measure" },
      { "measure": 73, "time": 205.71, "source": "section" },
      { "measure": 85, "time": 240.00, "source": "section" },
      { "measure": 87, "time": 247.50, "source": "measure" },
      { "measure": 89, "time": 258.00, "source": "terminal" }
    ]
  },
  "rests": [
    { "from": 1, "to": 8, "entrance": 9 },
    { "from": 49, "to": 56, "entrance": 57 }
  ],
  "lyrics": [
    { "id": "v1-1", "section": "verse-1", "from": 9, "to": 16, "text": "Morning comes across the river," },
    { "id": "v1-2", "section": "verse-1", "from": 17, "to": 24, "text": "every lantern burning low." }
  ],
  "loops": [
    { "id": "bridge-entrance", "name": "Bridge entrance", "from": 55, "to": 60,
      "note": "Count the rest, come in clean on 57." }
  ]
}
```

- `source` is `"section"`, `"measure"`, `"nudge"` or `"terminal"`. The setup page draws explicit and inferred boundaries differently.
- `score.line` (optional) names the tenor line shown when the tenors divide, for example `"Tenor 2"`. Without it, the single tenor line is shown.
- A page-image song replaces `score` with `{ "format": "page-images", "pages": [{ "id", "src" }], "regions": [{ "id", "page", "section", "rect": { "x", "y", "width", "height" } }] }`.
- A song with no timing yet has an empty `anchors` array; the app shows it unsynced (§7 frame 12).
- IDs are lowercase kebab-case and don't change when labels change.
- Measures are integers ≥ 0.

---

## 16. Setup page (desktop)

Timing is created here. It's at `/rehearsal/setup/`, desktop-only and not linked from the phone UI.

### Version 1: light

The full tool waits until the player works. Version 1 is a single page, based on the PoC's **Mark** button:

- Pick a song; its audio, sections and MusicXML or page images load from `../content/`.
- Play at any speed, with a large **Mark** button (and the spacebar). A mode switch chooses what a tap marks:
  - **Sections:** the start of the next section.
  - **Measures:** pick a range ("m. 81 to m. 88"); each tap marks the next measure. Long rests can be skipped; the re-entry measure is the one to mark.
- A list of marks with ±0.1 s nudges, Re-mark and Undo.
- Preview: a mini measure ribbon or section label playing in sync, so drift shows while you watch.
- Rest ranges proposed from MusicXML, to confirm.
- Loops added by measure range, with their computed times shown read-only.
- Validate (§12), then **Copy JSON** / **Download JSON**. The rest of the song file is edited by hand.

No tap-offset calibration; add it only if tapped marks turn out consistently late.

### Later: the full tool

The Oct 3 mockup's 1440 × 900 layout: song picker, format badge and Save in the top bar; a waveform with section flags and measure ticks (solid = tapped, hollow = inferred); sections list on the left; loops list on the right with each boundary's status ("start ✓ marked", "end ⚠ inferred — Mark"); a preview strip at the bottom.

### Workflow

1. Mark the sections for the whole song.
2. Play it back and watch the preview.
3. Run the per-measure pass only where it visibly drifts (usually endings, held notes and re-entries after rests).
4. Add loops when the teacher assigns them.

---

## 17. Architecture

### Stack

Plain HTML, CSS and JavaScript, with no build step and no framework. Code is split into ES modules (`<script type="module">`) served as separate files. Third-party code (the MusicXML renderer) is vendored into the repo, not loaded from a CDN, so it works offline.

### Layout

Everything the site serves lives under `app/`, the same way everything the PoC serves lives under `poc/`. The folder uploads as-is.

```text
app/                    → /rehearsal/
├── index.html
├── styles.css
├── manifest.webmanifest
├── sw.js               service worker (§19)
├── .htaccess           caching and MIME types
├── icons/
├── js/
│   ├── main.js         wiring and UI state
│   ├── playback.js     the audio element, commands, Media Session
│   ├── timing.js       anchors → measure boundaries, lookups
│   ├── loops.js        loop boundaries and wrapping
│   ├── content.js      loading and validating catalog and songs
│   ├── settings.js     persisted preferences
│   ├── views/          score, lyrics, score-lyrics, measure, whole-score
│   └── score/          page-images.js, musicxml.js
├── vendor/             the MusicXML renderer
├── setup/              the setup page → /rehearsal/setup/
├── content/            real content (gitignored) → /rehearsal/content/
└── content.example/    placeholder content (in git)
poc/                    the proof of concept → /rehearsal/poc/
tests/                  node:test unit tests (not uploaded)
docs/                   (not uploaded)
```

- Every URL inside `app/` is relative (no leading `/`), so the same files work at `http://localhost:8080/` and at `/rehearsal/`.
- `timing.js` and `loops.js` have no DOM code, so the same files run in the player, in the setup page, and under `node --test` (the tests import them from `app/js/`).

### Local development

From the repo root:

```powershell
npx http-server app -p 8080 -c-1
```

- `http://localhost:8080/` is the player and `http://localhost:8080/setup/` the setup page: the same layout as the live site.
- Use `http-server`, not Python's server, which has no Range support.
- On the phone, forward port 8080 from `chrome://inspect`. `localhost` counts as a secure context, so the service worker and Media Session work.
- Without `app/content/`, the player runs on the placeholder songs.

### Deploying

- With cPanel File Manager, upload the contents of `app/` into `public_html/rehearsal/`, keeping the folders. That includes `content/` and the `.htaccess` dotfile (turn on *Show Hidden Files* to check it's there). `content.example/` can be skipped.
- Bump `APP_VERSION` in `sw.js` whenever code changes, and `catalogRevision` in `content/catalog.json` whenever content changes, so phones pick up the update (§19).
- The PoC goes only into `public_html/rehearsal/poc/`. Never put the PoC's `sw.js` in `/rehearsal/` itself: it would take over the app's scope.
- `.htaccess`: `no-cache` for `.html`, `.js`, `.json` and `.webmanifest`; MIME types for `.mp3` (`audio/mpeg`), `.webmanifest` (`application/manifest+json`), `.musicxml` (`application/vnd.recordare.musicxml+xml`) and `.webp`.
- After uploading, check Range support on an MP3: `curl.exe -sI -H "Range: bytes=0-1" https://jordanmusselman.com/rehearsal/content/audio/song-1.mp3` must return `206 Partial Content`.

### State

- **Playback:** what the audio element reports (playing, time, duration, rate, errors).
- **Musical position:** section, measure, phrase, rest and loop, derived from time by `timing.js`.
- **UI:** view, open sheet, manual-scroll state, banners.
- **Preferences:** the persisted settings (§11).
- **Content:** the catalog revision, the current song, validation and offline status.

### MusicXML renderer

Test OpenSheetMusicDisplay (OSMD) and Verovio on the Pixel with the real tenor MusicXML before choosing. Check tenor-only rendering, the source clef shown unchanged (bass clef, with notes above the staff), access to measure positions for the ribbon, multi-measure rests, readability, and load time.

### Security and privacy

- HTTPS only (needed for the service worker and Media Session).
- No analytics, no third-party requests, no personal data.
- Rendered text from content files is escaped.

---

## 18. Lock screen and background playback

Verified on a Pixel 7 (Android 16, Chrome 153) with the PoC.

- Media Session metadata is set **once per track**: title is the song title, artist is "Tenor rehearsal", album is "Tenor Choir · Fall 2026", and the artwork is a 512 × 512 PNG (dark tile, steel-blue note). Android doesn't show the album; Android 16 draws the artwork as the media card's background.
- The metadata never changes during a track. Changing it can make Android redraw the notification.
- Action handlers: play, pause, previous track, next track, seek backward and forward, and seek to.
  - Previous and next work exactly like ⏮ and ⏭ (§11).
  - Seek backward/forward skip 5 s. Android sends no `seekOffset`, so the app's value is what applies.
- Playback continues with the screen off; loops keep wrapping while hidden.
- When playback stops at the end, Chrome removes the media notification. With Repeat Off this happens only after the last song.

---

## 19. Offline

### What's saved

- The app shell (HTML, CSS, JS modules, renderer, icons) and the catalog.
- Every song's JSON, audio and score files. All four songs are saved automatically after the first load; there's no download button.

### Service worker

- Hand-written. App files are versioned by `APP_VERSION` in `sw.js`; content by the catalog's `catalogRevision`.
- **Scope.** The player registers `sw.js` with scope `./`, which on the live site is `/rehearsal/`. That scope also covers `/rehearsal/setup/` and `/rehearsal/poc/`, so the worker ignores (never answers) any request under `setup/` or `poc/`:
  - the setup page always loads fresh from the server, and registers no service worker of its own;
  - the PoC keeps its own worker (scope `/rehearsal/poc/`, which wins for PoC pages) and is never served the app's files.
- App files: on the live site, served from the cache and refreshed in the background. On `localhost`, fetched network-first so edits show up without bumping the version.
- Audio: saved whole (a `200`, never a `206`). The audio element's Range requests are answered by slicing the cached file into a `206` response with `Content-Range`. The PoC proved this on the Pixel 7 with the server unreachable: reload, cold open, play, seek, ±5 s, loop wraps with the screen off, track changes from the app and the lock screen, and auto-advance while hidden.
- A new catalog revision downloads in the background and is used on the next launch, never mid-playback. The previous revision stays until the new one is complete.
- Request persistent storage (`navigator.storage.persist()`) but don't depend on it.

### Status line (Settings footer)

| Text | Meaning |
|---|---|
| `✓ Available offline · 4 songs` | All four songs and the app shell are saved. |
| `Saving for offline… 2 of 4` | Saving is in progress. |
| `Online only` | Saving can't run (no service worker or no space). |
| `Offline files need refresh` | A newer revision is known but not complete; the older one still works. |

Launching offline without a song's audio saved shows "This song isn't available offline yet" and disables Play for that song only.

---

## 20. Open questions

1. **Ribbon motion** (§6): line paging or continuous? Decide on the phone.
2. **Colors** (§3): decide on the phone.
3. **MusicXML renderer** (§17): OSMD or Verovio, after the phone test.
4. **Installed PWA.** Background playback and media controls when launched from the home screen, not a Chrome tab.
5. **Content still needed per song:** page images or MusicXML, the section map, rest ranges, lyric phrases. Loops come later from the teacher.

---

## 21. Implementation phases

1. **Device proof (nearly done).** The PoC covers background playback, media controls, metadata, artwork, loop wrapping and offline playback with seeking on the Pixel. Remaining: installed-PWA mode and the renderer comparison.
2. **Clickable prototype.** A single HTML file on a simulated clock with the placeholder data: all views, sheets, both ribbon motions, the rest countdown, loops, and the 360 dp chip row. Use it to choose colors and ribbon motion.
3. **Playback and timing core.** Real audio, the playback module, `timing.js` and `loops.js` with unit tests, settings persistence, song switching and Repeat. One song works end to end online.
4. **Page-image content.** Section crops, Whole Score, validation, Settings, lyrics size and error states. All four songs usable.
5. **Setup page (light).** Marking, nudges, per-measure pass, rest proposals, loops, preview, validate, JSON export.
6. **MusicXML Measure view.** The tenor-only adapter, ribbon, next line, syllables and multi-measure rests. Songs move over one at a time.
7. **Offline and PWA.** Manifest, service worker, revision caches, status line, update flow.
8. **Polish and release.** Accessibility, small screens, reduced motion, long-session stability, and the release checklist.

---

## 22. Testing

### Unit tests (`node --test`, no dependencies)

- Time-to-measure lookup at exact boundaries, between anchors, and at the song's end; uniform and notated-beat interpolation; a pickup at m. 0.
- Rest countdown before, during, and at the entrance.
- Loop boundaries (inclusive range to end time), wrapping, suspension after an outside seek.
- Section and phrase lookup.
- Content validation rules (§12).
- Settings fallback when stored state is missing or corrupt.

### Browser checks

- Launch, restore, one-tap play.
- Play/pause, seek, ±5 s, speed changes, ⏮/⏭ including wrap and the 3 s rule, Repeat modes.
- Switching views during playback without a time reset.
- Loops: enable, select, wrap, seek outside, cancel, disable.
- Offline load, uncached song, update flow.
- Score render failure with uninterrupted audio.
- Layouts at 360 × 800 and 412 × 915, plus landscape.

### On the Pixel

- Chrome tab and installed PWA.
- Screen locked for 5+ minutes while playing.
- Lock-screen and notification controls, metadata and artwork.
- A phone call or competing audio: no automatic resume.
- Airplane-mode cold launch after everything is saved.
- Rotation during playback and with a sheet open.
- Bluetooth headphone and watch controls.
- Pitch at 0.5× and 1.5×.
- Ribbon readability and control reach at arm's length.

### Content QA, per song

Every section start against the recording; every interpolated stretch sampled for drift; lyric text and ranges; every rest countdown and entrance; every loop listened through; measure numbers against the printed score.

---

## 23. Acceptance criteria

- [ ] Opens directly to the last song at 0:00, paused, playable with one tap. No library or download screen.
- [ ] Header has the title button and ⚙ only; no left chevron.
- [ ] Switch Song lists the four songs with durations; picking one plays it from 0:00.
- [ ] ⏮/⏭ step between songs with wrap and the 3 s restart rule, in the app and on the lock screen.
- [ ] Repeat Off / This song / All songs behave as specified at the end of each song.
- [ ] Speed 0.5–1.5× keeps pitch on the Pixel.
- [ ] Skip is 5 s everywhere, including the lock screen.
- [ ] All views reachable; Measure disabled honestly on page-image songs; Whole Score never auto-scrolls.
- [ ] No SATB, part picker, Car Mode or A–B controls anywhere.
- [ ] Steel blue only on current position, progress, play ring and active toggles; loop shading neutral.
- [ ] Rests hold on the rest and count down correctly; numbering continues through rests.
- [ ] Loops: off by default, chip only when on, banner and scrub range when active, correct wrap at every speed, × stops the loop without turning the feature off.
- [ ] Lock screen: title, "Tenor rehearsal", artwork; metadata never changes mid-track; playback survives screen lock.
- [ ] Airplane-mode cold launch plays all four songs, with seeking.
- [ ] The offline status line is truthful.
- [ ] Touch targets ≥ 48 dp; contrast meets WCAG 2.2 AA; reduced motion honored.
- [ ] The setup page can mark sections, refine a passage per measure, add loops, and export valid JSON.
