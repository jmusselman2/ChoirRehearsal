# Choir Rehearsal Player: Mockup Spec

Oct 3, 2026 · Jordan

This spec has everything needed to build the mockup from scratch, without the earlier mockups or the review. It includes the decisions from the Oct 3 mockup review and the follow-up review of that document (time map, loops, the interim Measure view, back gesture, and a few small fixes).

---

## 1. What this is

This is a phone-first web app (PWA) for practicing choir parts against rehearsal recordings. It plays an MP3 and shows the tenor line, the lyrics, or both, synced to the audio. It's hosted at `jordanmusselman.com/rehearsal/`.

- **Users.** Jordan first, plus one tenor friend practicing the same parts. It has no accounts and no login.
- **Content.** There are 4 songs (Tenor Choir, Fall 2026). Each song has one MP3, a tenor-only score, and lyrics.
- **Platforms.** Android is the priority, then desktop web (which also runs the setup screen), then iOS. iOS doesn't need every feature.
- **Must be true.** Background playback is reliable, the app works offline, and there's one tap from opening the page to playing.

## 2. Settled decisions

These are fixed. Don't redesign around them.

| Decision | Consequence for the mockup |
|---|---|
| **Straight into the action** | The app opens on the player, on the last song used, ready to play. There's no library, menu, or download step. |
| **Score is tenor-only** | Every notation view shows only the tenor line with lyrics. There's no SATB or full-system view anywhere. |
| **Audio is tenor-prominent** | The audio is a full-choir recording with the tenor brought forward. Tempo varies, with ritardandos, fermatas, and held notes. |
| **Score format** | Songs start as page images with section boxes drawn on them, then move to MusicXML song by song. Everything is keyed by measure, so data carries over between formats. |
| **Loops are secondary** | Loops are off by default. A loop is a named measure range assigned by Jordan's teacher. There's no tap-to-set A–B. |
| **Accent is a muted steel blue** | The accent is used only for the current position, the progress bar, the play button ring, and active toggles. |
| **No Car Mode** | Lock-screen controls cover eyes-free listening, and Lyrics Only covers a quick glance. |
| **Static lock screen** | The lock screen shows the song title, with "Tenor rehearsal" as the artist. Metadata is set once per track and doesn't update live. |
| **No left-side header chevron** | There's nothing to go back to. The control read as "close player." |
| **Measure view needs MusicXML** | Songs that only have page images don't offer Measure mode. The option is shown disabled with a reason. |
| **Whole Score opens from the view-mode menu** | It's a separate browse screen, not one of the synced view modes. |

### Explicitly out of scope

Leave these out of the mockup: a library or home screen, a "download all" button, SATB or full-score views, Car Mode, A–B tap looping, a gold accent, the left header chevron, a live section subtitle on the lock screen, and any login.

---

## 3. Visual system

### Canvas

- **Primary frame:** 412 × 915 dp (a typical Android phone). Check every phone screen at **360 dp wide** too.
- **Desktop frame** (Setup screen only): 1440 × 900.
- **Theme:** dark UI. Notation always sits on a light "paper" card, because score images are black on white. *(Assumption: if the earlier mockup used a light theme, swap the neutrals and keep everything else.)*

### Color tokens

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

### Shape and spacing

- Spacing scale: 4 / 8 / 12 / 16 / 24.
- Side gutter: 16 dp.
- Touch targets: at least 48 dp.
- Corner radius: 12 dp for cards and paper, 20 dp for the top corners of sheets, full pill for chips.
- Sheets slide up from the bottom over a 50% black scrim, with a grab handle at the top.

---

## 4. Persistent layout (phone)

From top to bottom:

1. **Status bar**, 24 dp.
2. **Header**, 56 dp, on `surface`.
   - Left: an empty spacer the same width as the right icon, so the title stays centered.
   - Center: the song title plus a small ⌄. Tapping it opens **Switch Song**.
   - Right: a ⚙ settings icon. Tapping it opens **Settings**.
3. **Practice loop banner** (only while a loop is active): 44 dp on `surface-2`. It shows "Loop · Bridge entrance · m. 39–44" and an × to stop the loop.
4. **Content area.** This depends on the view mode (§5).
5. **Player bar**, about 196 dp, on `surface`:
   - **Chip row**, 36 dp chips, left-aligned with 8 dp gaps:
     - Speed chip: `1.0×`.
     - View-mode chip: `Score + Lyrics ▾`.
     - Loop chip: `⟲ Loops`, or `⟲ Bridge entrance` while a loop is active. It shows only when the Loops toggle is on in Settings.
   - **Scrub bar** with elapsed time on the left and total time on the right. The played portion is `accent`. Section starts are small ticks. An active loop's range shows as a `loop-band` block.
   - **Transport**, centered: ⟲10 · ⏮ · ▶ · ⏭ · ⟳10. Play/pause is a 64 dp circle with a 2 dp `accent` ring. The other buttons are 48 dp.
     - ⏮ and ⏭ step between songs, not sections. ⏮ restarts the current song if playback is more than 3 s in; otherwise it goes to the previous song. ⏭ goes to the next song, wrapping from the last song to the first.
     - "Continue to next song" (§8) only controls what happens when a song ends. It doesn't change ⏮ or ⏭.

**Check at 360 dp:** all three chips have to fit on one row. If they don't, the view-mode chip drops the ▾ and shortens "Score + Lyrics" to "Score+Lyr". Never wrap to a second row.

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

- **Score.** A paper card showing the current section of the tenor score. For page-image songs, this is a crop of the section box. When the section changes, the card cross-fades to the next section. A thin `accent` bar on the card's left edge marks it as current.
- **Lyrics** (Lyrics Only). This is a vertical list of sections:
  - The current section is centered, bright (22 / 500), and has a 3 dp `accent` left marker.
  - The sections before and after are dimmed (`text-3`).
  - The section name sits above each block in small caps, `text-2`.
  - A− and A+ buttons sit on the right of the header, just left of ⚙. The left spacer widens to match, so the title stays centered.
  - The list scrolls itself. If the user scrolls manually, auto-follow pauses until they tap "Follow" (a small pill at the bottom of the list).
- **Score + Lyrics** (the default on launch). The paper card holds the current section and takes about 55% of the content area. Below it, the current section's lyrics appear at 20 / 500, with the next section's first line dimmed.
- **Measure** (Measure Follow-Along). This shows the measure ribbon (§6). Below the ribbon are the current section name and the lyric line for the current measure. It's only available for MusicXML songs.
- **Whole score.** This opens a full-screen browse view: the tenor pages, scrolled vertically, with no sync. The header shows "Whole score" and an × that returns to the player. A compact bar at the bottom (play/pause, title, elapsed time) keeps playback controllable.

---

## 6. Measure ribbon

The ribbon is the main screen once MusicXML exists, so it has to be large.

- **Size.** It's a paper card about 300 dp tall (roughly a third of the screen):
  - The **current line**, about 190 dp, shows **4–5 measures** of the tenor staff with lyrics under the notes.
  - The **next line**, about 90 dp, is shown below at `ink-faded`.
- **Position.** The current measure gets an `accent-tint` fill. A 2 dp `accent` playhead moves through it. Measure numbers sit above the staff.
- **Paging.** When the last measure on the current line ends, the next line slides up and becomes current. Paging is by line, like reading sheet music, rather than continuous scrolling.
- **Repeats.** On the second time through a repeated passage, the measure label reads `m. 17 · 2nd` and the lyrics show verse 2.
- **Tenor rests and countdown.** When the current measure falls inside a rest:
  - The ribbon holds on the rest. A multi-measure rest shows as one wide bar with its count above it (for example, "8").
  - A label above the staff reads **"Tenor enters in 4"**. The number is **measures**, and it counts down at each barline.
  - The entrance measure shows faded to the right of the rest. On the last measure before the entrance ("enters in 1"), it brightens to full `ink`.
  - At the entrance, the ribbon goes back to normal paging, with the entrance measure as the current measure.
- **Loop active.** The loop's measures get a `loop-band` fill behind the staff. Its start and end barlines are drawn 2 dp thicker.

---

## 7. Screens and states to draw

Phone frames are 412 × 915 and use the sample data in §10.

1. **Player, Score + Lyrics** (launch state): Song 1, Verse 1 playing at 0:41, paused. The loop chip is hidden.
2. **Switch Song** sheet: a compact list of the 4 songs (title plus duration). The current song is marked with a 3 dp `accent` bar on the left. There are no other buttons.
3. **Measure Follow-Along**, normal: Song 1, m. 18 (verse 1). Draw the current line and the faded next line.
4. **Measure Follow-Along, rest countdown**: Song 1, m. 36 during the 8-measure interlude rest. It shows "Tenor enters in 5", with m. 41 faded at the right.
5. **Lyrics Only**: the Chorus is current, with Verse 2 above it and the Interlude below, both dimmed. A−/A+ are in the header.
6. **View-mode menu** open, on a page-image song (Song 2), so Measure is disabled with "Needs MusicXML".
7. **Whole score** browse view.
8. **Settings** sheet (§8), with the Loops toggle **on**.
9. **Loop list** sheet, opened from the loop chip (§9).
10. **Practice Loop Active**: Measure view on Song 1 with "Bridge entrance" (m. 39–44) active. Show the banner, the shaded range on the ribbon (which also covers the end of the rest and the re-entry), the range on the scrub bar, and the loop chip showing the loop name.
11. **Lock screen / media notification** (Android): song title, "Tenor rehearsal" as the artist, a simple square artwork (a dark tile with a small steel-blue note mark), and prev / play-pause / next with the system seek bar. Prev and next step between songs, the same as ⏮ and ⏭ in the player (§4).
12. **Song without timing yet** (Song 4): the lyrics show as a static scrolling list with a subtle notice, "Timing not set — not synced". The audio still plays normally.
13. **Setup: Timing & Loops** (desktop, §11), in two states:
    - 13a. Section marking.
    - 13b. Per-measure pass on m. 65–72.

### Back gesture (annotate on frames 2, 6, 8, 9)

Android back closes the open sheet or menu and nothing more. From the player with nothing open, back leaves the app as normal. In the build, each sheet pushes a history entry when it opens.

---

## 8. Settings sheet

It's a bottom sheet with three groups and a footer.

- **Playback**
  - Speed: a segmented control with `0.75×`, `0.85×`, `1.0×`, `1.1×`. Pitch is kept.
  - Skip interval: 10 s (fixed; shown read-only).
  - Continue to next song: toggle, off.
- **Display**
  - View mode: Score / Lyrics / Score + Lyrics / Measure (Measure disabled on page-image songs).
  - Lyrics size: A− · 22 · A+.
  - Keep screen on while playing: toggle, on.
- **Practice loops**
  - Show loops: toggle, off by default. When it's on, the loop chip appears in the player bar.
  - A help line underneath: "Loops are set in Setup and assigned by your teacher."
- **Footer:** "✓ Available offline · 4 songs" in `text-2`, then the credit line (placeholder text) in `text-3`.

## 9. Loop list sheet

This is a short sheet titled "Practice loops — Song 1".

Each row shows the loop name (15 / 500), the range in `text-2` (for example, "m. 39–44 · 0:17"), and an optional teacher note on a second line in `text-3`. Tapping a row starts the loop and closes the sheet. The active loop's row has an `accent` left bar and a "Stop" text button. A song with no loops shows "No loops for this song."

---

## 10. Sample data (use this in every frame)

Lyrics are original placeholder text. Don't substitute real lyrics.

**Songs**

| # | Title (placeholder) | Length | Score format | Timing |
|---|---|---|---|---|
| 1 | Song One | 4:18 | MusicXML | Sections and per-measure marks |
| 2 | Song Two | 3:05 | Page images | Sections |
| 3 | Song Three | 2:47 | Page images | Sections |
| 4 | Song Four | 3:32 | Page images | Not set |

**Song 1 structure** (4/4, about 84 bpm, with a repeat)

| Section | Measures | Pass | Starts | Tenor |
|---|---|---|---|---|
| Intro | 1–8 | 1 | 0:00 | Rest (8 measures) |
| Verse 1 | 9–24 | 1 | 0:23 | Sings |
| Verse 2 | 9–24 | 2 | 1:09 | Sings (repeat of m. 9–24) |
| Chorus | 25–32 | 1 | 1:55 | Sings |
| Interlude | 33–40 | 1 | 2:17 | Rest (8 measures) |
| Bridge | 41–56 | 1 | 2:40 | Sings (enters m. 41) |
| Final chorus | 57–68 | 1 | 3:26 | Sings |
| Ending | 69–72 | 1 | 4:00 | Sings; ritardando, fermata on m. 71 |

**Song 1 loops**

- **Bridge entrance**, m. 39–44. Note: "Count the rest, come in clean on 41."
- **Final hold**, m. 67–72. Note: "Hold through the fermata, watch the cutoff."

**Placeholder lyrics**

- Verse 1: "Morning comes across the river, / every lantern burning low."
- Verse 2: "Evening falls along the meadow, / every field is turning gold."
- Chorus: "Carry me home, carry me home, / over the hill where the tall grass grows."
- Bridge: "Long is the road, but the light remains."
- Final chorus: "Carry me home, carry me home."
- Ending: "Home."

---

## 11. Setup: Timing & Loops (desktop)

This is where timing is created. It's desktop-only and not linked from the phone UI (the URL is `/rehearsal/setup`).

**Layout at 1440 × 900**

- **Top bar:** a song picker, the score format badge ("MusicXML" or "Page images"), and Save.
- **Waveform**, full width:
  - Section markers appear as labeled flags.
  - Measure positions appear as ticks below the waveform. **Solid ticks are tapped marks. Hollow ticks are interpolated.**
  - A second pass through repeated measures is labeled with "· 2nd".
- **Transport:** play/pause, speed, and a large **Tap** button (spacebar).
- **Mode switch:** `Sections` | `Measures`.
  - *Sections:* each tap marks the start of the next section.
  - *Measures* (the per-measure pass): choose a range ("from m. 65 to m. 72"). Each tap marks the next measure in playback order.
- **Tap offset** (per song): a value field (for example, `−0.15 s`) plus a "Calibrate" button. Calibrate has you tap 8 times along with a click track and sets the offset from the average lag. The offset applies to every tapped mark.
- **Left column: sections list.** Each row shows the name, the measure and pass, the timestamp, ±0.1 s nudges, and Re-mark.
- **Right column: loops list.** Each row shows the name, the range, and the note. Each boundary shows its timing status: "start ✓ marked" or "end ⚠ interpolated — Mark". New loops ask for both boundaries to be tapped.
- **Bottom: preview strip.** A live mini measure ribbon plays in sync, so drift shows up while you watch.

**Workflow this screen supports:**

1. Mark the sections for the whole song.
2. Play it back and watch the preview strip.
3. Run the per-measure pass only where it visibly drifts (usually endings and held notes).
4. Mark the loop boundaries.

Through long tenor rests, section marks plus interpolation are enough. The mark that matters is the measure where the tenor re-enters.

---

## 12. Time map and data model

The mockup doesn't render this, but the setup screen and the ribbon behavior depend on it.

**Rules**

- **The time map is ordered by playback.** Each entry is `{ seq, measure, pass, time, source }`. A repeated measure appears once per pass. Measure numbers alone are **not** unique in time.
- **Measure numbers count through rests**, exactly as in the full score. A multi-measure rest covering m. 33–40 still takes up 8 measure numbers.
- Sections, lyrics, and loops point at `{ measure, pass }`.
- **Interpolation:** between two entries, measures are spaced evenly in time. A tapped entry always overrides an interpolated one.
- `source` is `"section"`, `"tap"`, or `"interpolated"`. This drives the solid and hollow ticks in Setup.
- Tap offset is stored per song and applied when a tap is recorded.
- Rest ranges come from MusicXML. Page-image songs don't have them, which is why Measure mode (and with it the countdown) is MusicXML-only.

**Shape (example)**

```json
{
  "id": "song-1",
  "title": "Song One",
  "audio": "audio/song-1.mp3",
  "score": { "format": "musicxml", "src": "scores/song-1.musicxml" },
  "tapOffset": -0.15,
  "sections": [
    { "name": "Verse 1", "start": { "measure": 9, "pass": 1 } },
    { "name": "Verse 2", "start": { "measure": 9, "pass": 2 } }
  ],
  "timeMap": [
    { "seq": 0,  "measure": 1,  "pass": 1, "time": 0.00,   "source": "section" },
    { "seq": 8,  "measure": 9,  "pass": 1, "time": 22.86,  "source": "section" },
    { "seq": 24, "measure": 9,  "pass": 2, "time": 68.57,  "source": "section" },
    { "seq": 56, "measure": 41, "pass": 1, "time": 160.00, "source": "tap" }
  ],
  "loops": [
    { "name": "Bridge entrance",
      "from": { "measure": 39, "pass": 1 }, "to": { "measure": 44, "pass": 1 },
      "note": "Count the rest, come in clean on 41." }
  ],
  "lyrics": [
    { "section": "Verse 1", "lines": ["Morning comes across the river,", "every lantern burning low."] }
  ]
}
```

---

## 13. Lock screen and background playback

- Media Session metadata is set **once per track**: title is the song title, artist is "Tenor rehearsal", album is "Tenor Choir · Fall 2026", plus the artwork tile.
- The action handlers are play, pause, previous track, next track, seek backward and forward (10 s), and seek to.
- Previous track and next track step between songs, exactly like ⏮ and ⏭ in the player (§4): previous restarts the current song if playback is more than 3 s in, otherwise it goes to the previous song; next goes to the next song and wraps from the last to the first.
- When a song ends, playback stops unless "Continue to next song" (§8) is on.
- The metadata never changes during a track. Changing it can make Android redraw the notification.

## 14. Prototype notes (next step after the mockup)

- Build a single HTML file. It can run on a simulated clock for screen flows.
- **Lock-screen and background behavior can't be tested on a simulated clock.** For that, drive it from a real `<audio>` element with a short test MP3, or confirm the existing proof of concept already covers it.
- On an Android phone, check:
  - ribbon size and paging
  - the chip row at 360 dp
  - the rest countdown
  - loop chip show/hide
  - back-gesture behavior with each sheet open
- Afterward, update the project brief: tenor-only score, tenor rests, the playback-ordered time map, the per-measure pass and tap offset, loop boundary marks, static lock-screen metadata, and Car Mode removed.
