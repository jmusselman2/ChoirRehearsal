// Timing authoring for the setup page (spec §16): the Mark session, rest and lyric-phrase
// proposals from MusicXML, and building the exported song file. No DOM code, so it runs under
// node --test; the setup page is a thin UI over it.

const ID_SAFE = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
export const round2 = (t) => Math.round(t * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Marking

/** Section-mode targets: the first measure and every section start, in order. */
export function sectionTargets(song) {
  const set = new Set([song.measures.first, ...song.sections.map((s) => s.from)]);
  return [...set].filter((m) => m >= song.measures.first && m <= song.measures.last).sort((a, b) => a - b);
}

/** Measure-mode targets: every measure in the inclusive range, clamped to the song. */
export function measureTargets(song, from, to) {
  const lo = Math.max(song.measures.first, Math.min(from, to));
  const hi = Math.min(song.measures.last, Math.max(from, to));
  const out = [];
  for (let m = lo; m <= hi; m++) out.push(m);
  return out;
}

/**
 * A Mark session. Marks are explicit anchors keyed by measure; the terminal anchor (the song's
 * duration at the measure after the last) is added on export.
 */
export function createMarkSession(song) {
  const marks = new Map(); // measure → {time, source}
  for (const a of (song.timing && song.timing.anchors) || []) {
    if (a.measure <= song.measures.last) marks.set(a.measure, { time: a.time, source: a.source });
  }
  const history = []; // for Undo: [{measure, previous}]
  let mode = 'sections';
  let targets = sectionTargets(song);
  let cursor = 0;

  const firstUnmarked = () => {
    const i = targets.findIndex((m) => !marks.has(m));
    return i === -1 ? targets.length : i;
  };
  cursor = firstUnmarked();

  function set(measure, time, source) {
    history.push({ measure, previous: marks.has(measure) ? { ...marks.get(measure) } : null });
    marks.set(measure, { time: round2(Math.max(0, time)), source });
  }

  return {
    get mode() { return mode; },
    get targets() { return targets.slice(); },
    get cursor() { return cursor; },
    /** The measure the next Mark will set, or null when the pass is complete. */
    get next() { return cursor < targets.length ? targets[cursor] : null; },
    get canUndo() { return history.length > 0; },

    /** Sorted explicit marks. */
    marks() {
      return [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([measure, m]) => ({ measure, ...m }));
    },

    setSectionsMode() {
      mode = 'sections';
      targets = sectionTargets(song);
      cursor = firstUnmarked();
    },

    /** Per-measure pass over an inclusive range ("m. 81 to m. 88"); starts at its first measure. */
    setMeasuresMode(from, to) {
      mode = 'measures';
      targets = measureTargets(song, from, to);
      cursor = 0;
    },

    /** Moves the cursor so the next Mark sets this measure (it must be a current target). */
    aim(measure) {
      const i = targets.indexOf(measure);
      if (i !== -1) cursor = i;
    },

    /** Marks the next target at time t. Returns the marked measure, or null when done. */
    mark(t) {
      if (cursor >= targets.length) return null;
      const measure = targets[cursor];
      set(measure, t, mode === 'sections' ? 'section' : 'measure');
      cursor++;
      return measure;
    },

    /** Skips the next target without marking it (a long rest; the re-entry is the one to mark). */
    skip() {
      if (cursor < targets.length) cursor++;
    },

    /** Re-marks one measure at time t, keeping its source. */
    remark(measure, t) {
      const existing = marks.get(measure);
      set(measure, t, existing ? existing.source : 'measure');
    },

    /** ±0.1 s (or any delta) nudge; the anchor's source becomes "nudge". */
    nudge(measure, delta) {
      const existing = marks.get(measure);
      if (!existing) return;
      set(measure, existing.time + delta, 'nudge');
    },

    /** Removes a mark (Undo restores it). */
    remove(measure) {
      if (!marks.has(measure)) return;
      history.push({ measure, previous: { ...marks.get(measure) } });
      marks.delete(measure);
    },

    undo() {
      const step = history.pop();
      if (!step) return null;
      if (step.previous) marks.set(step.measure, step.previous);
      else marks.delete(step.measure);
      const i = targets.indexOf(step.measure);
      if (i !== -1 && i < cursor) cursor = i;
      return step.measure;
    },

    clear() {
      for (const measure of [...marks.keys()]) {
        history.push({ measure, previous: { ...marks.get(measure) } });
        marks.delete(measure);
      }
      cursor = 0;
    },

    /** Anchors for the song file: the marks plus the terminal anchor at the song's duration. */
    anchors(durationSeconds = song.durationSeconds) {
      const list = this.marks().map(({ measure, time, source }) => ({ measure, time: round2(time), source }));
      if (list.length === 0) return [];
      list.push({ measure: song.measures.last + 1, time: round2(durationSeconds), source: 'terminal' });
      return list;
    },

    /** Marks whose time doesn't increase over the previous mark (shown as a warning while marking). */
    outOfOrder() {
      const list = this.marks();
      return list.filter((m, i) => i > 0 && m.time <= list[i - 1].time).map((m) => m.measure);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Proposals from MusicXML (spec §13 rests, §14 phrases). A person confirms or edits them.

/**
 * Rest ranges: runs of measures with no pitched notes. Each entrance is the next measure;
 * a rest that runs to the end has none.
 *
 * @param {Array<{measure: number, rest: boolean}>} notes from readNotes()
 */
export function proposeRests(notes, first, last) {
  const pitched = new Set(notes.filter((n) => !n.rest).map((n) => n.measure));
  const rests = [];
  let start = null;
  for (let m = first; m <= last + 1; m++) {
    const resting = m <= last && !pitched.has(m);
    if (resting && start === null) start = m;
    if (!resting && start !== null) {
      const rest = { from: start, to: m - 1 };
      if (m - 1 < last) rest.entrance = m;
      rests.push(rest);
      start = null;
    }
  }
  return rests;
}

// Sentence-ending punctuation always breaks a phrase; a comma breaks one only once it's long, so
// "God rest ye merry, gentlemen …" stays together.
export const COMMA_BREAK_SYLLABLES = 6;
const ENDS_PHRASE = /[.;:!?]["'”’)\]]*$/;

/**
 * Lyric phrases: syllables joined into words, broken at rests, at sentence-ending punctuation and
 * at section boundaries. Punctuation, capitalization and apostrophes are kept as written.
 *
 * Ranges follow the rule used for the real songs: a phrase starts at its first sung measure (or
 * the next one, if that measure still holds the previous phrase's last syllable) and runs up to
 * where the next phrase starts, or to its last sung measure when a rest or section end comes first.
 *
 * @param {Array<{measure: number, rest: boolean, lyric: object|null}>} notes from readNotes()
 * @param {Array<{id: string, from: number, to: number}>} sections
 */
export function proposePhrases(notes, sections, { commaAfter = COMMA_BREAK_SYLLABLES } = {}) {
  const sectionOf = (m) => sections.find((s) => m >= s.from && m <= s.to) || null;
  const phrases = [];
  let words = [];
  let word = null;
  let restSinceWord = false;
  let syllables = 0; // in the phrase so far

  const flushWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const flushPhrase = () => {
    flushWord();
    if (!words.length) return;
    const section = sectionOf(words[0].from);
    phrases.push({
      section: section ? section.id : null,
      from: words[0].from,
      to: words[words.length - 1].to,
      text: words.map((w) => w.text).join(' '),
    });
    words = [];
    syllables = 0;
  };

  for (const note of notes) {
    if (note.rest) {
      // A rest inside a word (rare) doesn't split it; between words it ends the phrase.
      if (!word) restSinceWord = true;
      continue;
    }
    if (!note.lyric) {
      if (word) word.to = note.measure; // a melisma extends the word
      continue;
    }
    const { text, syllabic } = note.lyric;
    const startsWord = !word || syllabic === 'single' || syllabic === 'begin';
    if (startsWord) {
      flushWord();
      const previous = words[words.length - 1];
      const crossesSection = previous && sectionOf(previous.from) !== sectionOf(note.measure);
      const longAtComma = previous && /,["'”’)\]]*$/.test(previous.text) && syllables >= commaAfter;
      if (previous && (restSinceWord || ENDS_PHRASE.test(previous.text) || crossesSection || longAtComma)) flushPhrase();
      word = { text, from: note.measure, to: note.measure };
      syllables++;
    } else {
      syllables++;
      word.text += text;
      word.to = note.measure;
    }
    restSinceWord = false;
  }
  flushPhrase();

  // Phrase ranges may not overlap (spec §12): a phrase that starts in the measure where the
  // previous one ends starts at the next measure, or joins the previous phrase if that's all it has.
  const merged = [];
  for (const p of phrases) {
    const prev = merged[merged.length - 1];
    if (prev && p.from <= prev.to) {
      if (p.to <= prev.to || p.section !== prev.section) {
        prev.text = `${prev.text} ${p.text}`;
        prev.to = Math.max(prev.to, p.to);
        continue;
      }
      p.from = prev.to + 1;
    }
    merged.push({ ...p });
  }

  const resting = new Set();
  const pitched = new Set(notes.filter((n) => !n.rest).map((n) => n.measure));
  for (const n of notes) if (!pitched.has(n.measure)) resting.add(n.measure);
  for (let i = 0; i < merged.length - 1; i++) {
    const p = merged[i];
    const next = merged[i + 1];
    if (p.section !== next.section) continue;
    let end = p.to;
    while (end + 1 < next.from && !resting.has(end + 1)) end++;
    p.to = end;
  }

  const counts = new Map();
  return merged.map((p) => {
    const base = p.section || 'phrase';
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return { id: `${ID_SAFE(base)}-${n}`, section: p.section, from: p.from, to: p.to, text: p.text };
  });
}

// ---------------------------------------------------------------------------------------------
// Export

/** A loop id from its name, unique among the existing ids. */
export function loopId(name, existing) {
  const base = ID_SAFE(name);
  let id = base;
  for (let i = 2; existing.includes(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * The complete song file: the original song with its timing, rests, lyrics, loops and
 * (optionally) duration replaced. Key order follows spec §15.
 */
export function buildSongFile(song, { anchors, rests, lyrics, loops, durationSeconds } = {}) {
  const out = {};
  for (const key of ['id', 'title', 'durationSeconds', 'measures', 'audio', 'score', 'sections', 'timing', 'rests', 'lyrics', 'loops']) {
    if (song[key] !== undefined) out[key] = song[key];
  }
  for (const [key, value] of Object.entries(song)) if (!(key in out)) out[key] = value;
  if (durationSeconds !== undefined) out.durationSeconds = round2(durationSeconds);
  if (anchors) out.timing = { ...song.timing, anchors };
  if (rests) out.rests = rests;
  if (lyrics) out.lyrics = lyrics;
  if (loops) out.loops = loops;
  return out;
}

/** JSON with small objects and arrays on one line, like the examples in the spec. */
export function formatSongJson(value) {
  const inline = (v) => {
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v);
      return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
    }
    return JSON.stringify(v);
  };
  const format = (v, indent) => {
    const one = inline(v);
    if (v === null || typeof v !== 'object' || one.length + indent.length <= 150) return one;
    const inner = `${indent}  `;
    if (Array.isArray(v)) return `[\n${v.map((x) => inner + format(x, inner)).join(',\n')}\n${indent}]`;
    return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${format(x, inner)}`).join(',\n')}\n${indent}}`;
  };
  return `${format(value, '')}\n`;
}
