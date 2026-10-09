// Timing: anchors → a boundary for every printed measure, and every lookup that depends on time
// (measure, section, lyric phrase, tenor rest and countdown, loop). Views never compute timing
// themselves; they read the Position this module returns (spec §12).
//
// No DOM code: the same file runs in the player, the setup page and under node --test.

/**
 * Builds the measure-boundary table for a validated song.
 *
 * @param {object} song  A song file (§15) that passed validateSong() with no sync errors.
 * @param {{beats?: Map<number, number>}} [options]
 *   beats: quarter-note length of each printed measure, read from the MusicXML. Needed for
 *   "notated-beats" interpolation; without it the timeline falls back to uniform spacing.
 * @returns {Timeline|null} null when the song has no timing anchors yet.
 */
export function buildTimeline(song, options = {}) {
  const anchors = song.timing && Array.isArray(song.timing.anchors) ? song.timing.anchors : [];
  if (anchors.length === 0) return null;
  return new Timeline(song, anchors, options.beats || null);
}

/** Interpolated start time of measure m between anchors (a, tA) and (b, tB), uniform spacing. */
export function uniformTime(a, tA, b, tB, m) {
  return tA + ((m - a) / (b - a)) * (tB - tA);
}

/** Interpolated start time of measure m by notated beats; beatsOf(k) is measure k's length. */
export function notatedBeatsTime(a, tA, b, tB, m, beatsOf) {
  let total = 0;
  let before = 0;
  for (let k = a; k < b; k++) {
    const len = beatsOf(k);
    if (k < m) before += len;
    total += len;
  }
  return total > 0 ? tA + (before / total) * (tB - tA) : uniformTime(a, tA, b, tB, m);
}

function hasAllBeats(beats, first, last) {
  if (!beats) return false;
  for (let m = first; m <= last; m++) {
    const len = beats.get(m);
    if (!(len > 0)) return false;
  }
  return true;
}

export class Timeline {
  constructor(song, anchors, beats) {
    const first = song.measures.first;
    const last = song.measures.last;
    if (anchors[0].measure !== first || anchors[anchors.length - 1].measure !== last + 1) {
      throw new Error('Timing anchors must start at the first measure and end with a terminal anchor');
    }
    this.first = first;
    this.last = last;
    this.duration = song.durationSeconds;
    this.requestedInterpolation = song.timing.interpolation;
    this.interpolation = song.timing.interpolation;
    this.interpolationFallback = false;
    if (this.interpolation === 'notated-beats' && !hasAllBeats(beats, first, last)) {
      this.interpolation = 'uniform';
      this.interpolationFallback = true;
    }

    const count = last - first + 1;
    // starts[i] is the start of measure first + i; starts[count] is the terminal anchor.
    this.starts = new Float64Array(count + 1);
    this.explicit = new Array(count + 1).fill(false);
    const beatsOf = (m) => beats.get(m);
    for (let k = 0; k < anchors.length; k++) {
      const a = anchors[k];
      this.starts[a.measure - first] = a.time;
      this.explicit[a.measure - first] = true;
      const b = anchors[k + 1];
      if (!b) break;
      for (let m = a.measure + 1; m < b.measure; m++) {
        this.starts[m - first] = this.interpolation === 'notated-beats'
          ? notatedBeatsTime(a.measure, a.time, b.measure, b.time, m, beatsOf)
          : uniformTime(a.measure, a.time, b.measure, b.time, m);
      }
    }
    this.end = this.starts[count];

    this.sections = (song.sections || []).slice().sort((x, y) => x.from - y.from);
    this.phrases = (song.lyrics || []).slice().sort((x, y) => x.from - y.from);
    this.rests = (song.rests || []).slice().sort((x, y) => x.from - y.from);
    this.loops = (song.loops || []).slice();

    // Per-measure lookup tables, so a frame's lookup is a binary search plus array reads.
    this.sectionAt = new Int32Array(count).fill(-1);
    this.phraseAt = new Int32Array(count).fill(-1);
    this.nextPhraseAt = new Int32Array(count).fill(-1);
    this.restAt = new Int32Array(count).fill(-1);
    const fill = (table, list) => {
      list.forEach((item, idx) => {
        for (let m = Math.max(item.from, first); m <= Math.min(item.to, last); m++) table[m - first] = idx;
      });
    };
    fill(this.sectionAt, this.sections);
    fill(this.phraseAt, this.phrases);
    fill(this.restAt, this.rests);
    for (let m = first; m <= last; m++) this.nextPhraseAt[m - first] = this.phraseIndexStartingAfter(m);
  }

  phraseIndexStartingAfter(m) {
    for (let i = 0; i < this.phrases.length; i++) if (this.phrases[i].from > m) return i;
    return -1;
  }

  /** Index (measure − first) of the last boundary ≤ t; clamps before the first and after the last measure. */
  indexAt(t) {
    const s = this.starts;
    const lastIndex = s.length - 2;
    if (!(t >= s[0])) return 0;
    if (t >= s[lastIndex]) return lastIndex;
    let lo = 0;
    let hi = lastIndex;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  measureAt(t) {
    return this.first + this.indexAt(t);
  }

  /** Start time of printed measure m; m = last + 1 gives the terminal anchor. */
  measureStart(m) {
    const i = Math.min(Math.max(m, this.first), this.last + 1) - this.first;
    return this.starts[i];
  }

  /** End time of printed measure m (the start of the next measure). */
  measureEnd(m) {
    return this.measureStart(m + 1);
  }

  isExplicit(m) {
    return this.explicit[m - this.first] === true;
  }

  /** Time range of an inclusive measure-range loop (spec §9). */
  loopRange(loop) {
    const start = this.measureStart(loop.from);
    const end = loop.to >= this.last ? this.duration : this.measureStart(loop.to + 1);
    return { start, end };
  }

  /** Fraction (0–1) of the way t is through the inclusive measure range from–to. */
  progressThrough(from, to, t) {
    const start = this.measureStart(from);
    const end = this.measureEnd(to);
    return end > start ? Math.min(Math.max((t - start) / (end - start), 0), 1) : 0;
  }

  sectionStarts() {
    return this.sections.map((s) => ({ id: s.id, label: s.label, measure: s.from, time: this.measureStart(s.from) }));
  }

  sectionById(id) {
    return this.sections.find((s) => s.id === id) || null;
  }

  /**
   * Everything a view needs at time t.
   *
   * @param {number} t audio.currentTime
   * @param {{loop?: object, status?: string}|null} [loopState] the playback module's loop state
   */
  positionAt(t, loopState = null) {
    const index = this.indexAt(t);
    const measure = this.first + index;
    const start = this.starts[index];
    const end = this.starts[index + 1];
    const progress = end > start ? Math.min(Math.max((t - start) / (end - start), 0), 1) : 0;

    const sectionIndex = this.sectionAt[index];
    const phraseIndex = this.phraseAt[index];
    const nextPhraseIndex = this.nextPhraseAt[index];
    const restIndex = this.restAt[index];

    let rest = null;
    if (restIndex !== -1) {
      const r = this.rests[restIndex];
      const entrance = Number.isInteger(r.entrance) && r.entrance <= this.last ? r.entrance : null;
      rest = {
        from: r.from,
        to: r.to,
        label: r.label || null,
        measures: r.to - r.from + 1,
        entrance,
        // Measures remaining before the entrance; it counts down at each barline.
        countdown: entrance === null ? null : entrance - measure,
      };
    }

    let loop = null;
    if (loopState && loopState.loop && loopState.status && loopState.status !== 'off') {
      const range = this.loopRange(loopState.loop);
      loop = {
        id: loopState.loop.id,
        name: loopState.loop.name,
        from: loopState.loop.from,
        to: loopState.loop.to,
        start: range.start,
        end: range.end,
        status: loopState.status,
        inside: t >= range.start && t < range.end,
      };
    }

    return {
      timed: true,
      time: t,
      measure,
      measureStart: start,
      measureEnd: end,
      measureProgress: progress,
      beforeStart: t < this.starts[0],
      afterEnd: t >= this.end,
      sectionIndex,
      section: sectionIndex === -1 ? null : this.sections[sectionIndex],
      phraseIndex,
      phrase: phraseIndex === -1 ? null : this.phrases[phraseIndex],
      nextPhraseIndex,
      nextPhrase: nextPhraseIndex === -1 ? null : this.phrases[nextPhraseIndex],
      rest,
      loop,
    };
  }
}
