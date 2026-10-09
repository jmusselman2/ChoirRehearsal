#!/usr/bin/env node
// Generates the placeholder Song One–Four in app/content.example/ (spec §10, §15): the catalog,
// the four song files, tenor-only MusicXML, and MP3s with one short tone at the start of every
// measure. Everything is original placeholder material; nothing comes from a real arrangement.
//
// The output is deterministic. The tones are placed with app/js/timing.js, the same module the
// player uses, so the audio lines up with the song files' anchors by construction.
//
//   node tools/generate-sample-content.mjs              writes JSON, MusicXML and MP3s
//   node tools/generate-sample-content.mjs --no-audio   skips the MP3s (no ffmpeg needed)
//
// The MP3s need ffmpeg with libmp3lame on the PATH. Only this script needs it, never the player.

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTimeline } from '../app/js/timing.js';
import { readMeasureBeats } from '../app/js/score/measures.js';
import { validateCatalog, validateSong } from '../app/js/content.js';
import { formatSongJson } from '../app/js/authoring.js';

const OUT = fileURLToPath(new URL('../app/content.example/', import.meta.url));
const SAMPLE_RATE = 22050;
const DIVISIONS = 2; // an eighth note is one division

// ---------------------------------------------------------------------------------------------
// Song definitions. Lyric syllables are hyphenated here; the song file's phrase text joins them.

const SONGS = [
  {
    id: 'song-one',
    title: 'Song One',
    durationSeconds: 258.0,
    measures: { first: 1, last: 88 },
    tempo: 84,
    meters: [{ from: 1, beats: 4 }],
    key: -1, // F major
    clef: 'bass', // spec §13: the first song's tenors print in bass clef, with ledger lines up high
    partName: 'Tenor',
    seed: 11,
    fermatas: [87],
    rit: 85,
    sections: [
      ['intro', 'Intro', 1, 8],
      ['verse-1', 'Verse 1', 9, 24],
      ['verse-2', 'Verse 2', 25, 40],
      ['chorus', 'Chorus', 41, 48],
      ['interlude', 'Interlude', 49, 56],
      ['bridge', 'Bridge', 57, 72],
      ['final-chorus', 'Final chorus', 73, 84],
      ['ending', 'Ending', 85, 88],
    ],
    interpolation: 'uniform',
    // Spec §15, verbatim: sections plus per-measure marks at the entrance and the ritardando.
    anchors: [
      [1, 0.0, 'section'], [9, 22.86, 'section'], [25, 68.57, 'section'], [41, 114.29, 'section'],
      [49, 137.14, 'section'], [57, 160.0, 'measure'], [73, 205.71, 'section'], [85, 240.0, 'section'],
      [87, 247.5, 'measure'], [89, 258.0, 'terminal'],
    ],
    rests: [{ from: 1, to: 8, entrance: 9 }, { from: 49, to: 56, entrance: 57 }],
    lyrics: [
      ['v1-1', 'verse-1', 9, 16, 'Mor-ning comes a-cross the ri-ver,'],
      ['v1-2', 'verse-1', 17, 24, 'ev-ery lan-tern burn-ing low.'],
      ['v2-1', 'verse-2', 25, 32, 'Eve-ning falls a-long the mea-dow,'],
      ['v2-2', 'verse-2', 33, 40, 'ev-ery field is turn-ing gold.'],
      ['ch-1', 'chorus', 41, 44, 'Car-ry me home, car-ry me home,'],
      ['ch-2', 'chorus', 45, 48, 'o-ver the hill where the tall grass grows.'],
      ['br-1', 'bridge', 57, 64, 'Long is the road,'],
      ['br-2', 'bridge', 65, 72, 'but the light re-mains.'],
      ['fc-1', 'final-chorus', 73, 84, 'Car-ry me home, car-ry me home.'],
      ['end-1', 'ending', 85, 88, 'Home.'],
    ],
    loops: [
      { id: 'bridge-entrance', name: 'Bridge entrance', from: 55, to: 60, note: 'Count the rest, come in clean on 57.' },
      { id: 'final-hold', name: 'Final hold', from: 83, to: 88, note: 'Hold through the fermata, watch the cutoff.' },
    ],
  },
  {
    id: 'song-two',
    title: 'Song Two',
    durationSeconds: 185.0,
    measures: { first: 0, last: 70 }, // starts with a one-beat pickup, m. 0
    tempo: 84,
    leadIn: 0.5,
    pickupBeats: 1,
    // The refrains change to 3/4, so this song uses notated-beat interpolation (spec §12).
    meters: [{ from: 0, beats: 4 }, { from: 17, beats: 3 }, { from: 29, beats: 4 }, { from: 51, beats: 3 }, { from: 63, beats: 4 }],
    key: 1, // G major
    clef: 'treble-8',
    partName: 'Tenor',
    seed: 23,
    sections: [
      ['verse-1', 'Verse 1', 0, 16],
      ['refrain-1', 'Refrain', 17, 28],
      ['interlude', 'Interlude', 29, 34],
      ['verse-2', 'Verse 2', 35, 50],
      ['refrain-2', 'Refrain 2', 51, 62],
      ['coda', 'Coda', 63, 70],
    ],
    interpolation: 'notated-beats',
    anchors: 'sections', // section starts only, read off the tempo grid
    rests: [{ from: 29, to: 34, entrance: 35 }, { from: 69, to: 70 }], // the last rest runs to the end
    lyrics: [
      ['v1-1', 'verse-1', 0, 8, 'Oh, the hills are wak-ing slow-ly, and the val-ley hums a-long,'],
      ['v1-2', 'verse-1', 9, 16, 'ev-ery win-dow lit and o-pen to the qui-et morn-ing song.'],
      ['r1-1', 'refrain-1', 17, 22, 'Sing a-loud, sing a-loud,'],
      ['r1-2', 'refrain-1', 23, 28, 'let the morn-ing car-ry the sound.'],
      ['v2-1', 'verse-2', 35, 42, 'Now the ri-ver turns to sil-ver, and the swal-lows cir-cle high,'],
      ['v2-2', 'verse-2', 43, 50, 'ev-ery sha-dow short-er, light-er, as the noon-day hours go by.'],
      ['r2-1', 'refrain-2', 51, 56, 'Sing a-loud, sing a-loud,'],
      ['r2-2', 'refrain-2', 57, 62, 'let the eve-ning car-ry the sound.'],
      ['co-1', 'coda', 63, 68, 'Car-ry the sound a-way.'],
    ],
    loops: [],
  },
  {
    id: 'song-three',
    title: 'Song Three',
    durationSeconds: 167.0,
    measures: { first: 1, last: 50 },
    tempo: 72,
    meters: [{ from: 1, beats: 4 }],
    key: 2, // D major
    clef: 'treble-8',
    partName: 'Tenor',
    seed: 37,
    sections: [
      ['intro', 'Intro', 1, 2],
      ['verse-1', 'Verse 1', 3, 18],
      ['verse-2', 'Verse 2', 19, 34],
      ['final-verse', 'Final verse', 35, 50],
    ],
    interpolation: 'uniform',
    anchors: 'sections',
    // A one-measure rest inside Verse 2 exercises "Tenor enters in 1".
    rests: [{ from: 1, to: 2, entrance: 3 }, { from: 26, to: 26, entrance: 27 }],
    lyrics: [
      ['v1-1', 'verse-1', 3, 10, 'Lan-terns hang a-long the har-bor, bob-bing in the eve-ning tide,'],
      ['v1-2', 'verse-1', 11, 18, 'and the boats come home to shel-ter where the qui-et wa-ters hide.'],
      ['v2-1', 'verse-2', 19, 25, 'Some-one sings a-cross the wa-ter, some-one an-swers from the shore,'],
      ['v2-2', 'verse-2', 27, 34, 'and the tune goes on and on, a lit-tle sweet-er than be-fore.'],
      ['fv-1', 'final-verse', 35, 42, 'Lan-terns hang a-long the har-bor, light-ing ev-ery-one their way,'],
      ['fv-2', 'final-verse', 43, 50, 'home a-gain, home a-gain, at the clos-ing of the day.'],
    ],
    loops: [],
  },
  {
    id: 'song-four',
    title: 'Song Four',
    durationSeconds: 212.0,
    measures: { first: 1, last: 60 },
    tempo: 68,
    meters: [{ from: 1, beats: 4 }],
    key: -3, // E-flat major
    clef: 'treble-8',
    partName: 'Tenor II',
    line: 'Tenor 2', // the tenors divide; the recording features Tenor 2 (spec §13)
    seed: 41,
    sections: [
      ['intro', 'Intro', 1, 4],
      ['verse-1', 'Verse 1', 5, 20],
      ['verse-2', 'Verse 2', 21, 36],
      ['interlude', 'Interlude', 37, 40],
      ['verse-3', 'Verse 3', 41, 56],
      ['amen', 'Amen', 57, 60],
    ],
    interpolation: 'uniform',
    anchors: 'none', // timing not set yet (spec §7 frame 12)
    rests: [{ from: 1, to: 4, entrance: 5 }, { from: 37, to: 40, entrance: 41 }],
    lyrics: [
      ['v1-1', 'verse-1', 5, 12, 'Qui-et now the snow is fall-ing, cov-er-ing the sleep-ing town,'],
      ['v1-2', 'verse-1', 13, 20, 'ev-ery roof and ev-ery stee-ple wear-ing white and set-tling down.'],
      ['v2-1', 'verse-2', 21, 28, 'Foot-steps fade a-long the lane-way, can-dles flick-er one by one,'],
      ['v2-2', 'verse-2', 29, 36, "till the night is still and qui-et and the long day's work is done."],
      ['v3-1', 'verse-3', 41, 48, 'Qui-et now the bells are ring-ing, call-ing ev-ery tra-vel-er in,'],
      ['v3-2', 'verse-3', 49, 56, 'warm the hearth and wide the door-way, let the eve-ning song be-gin.'],
      ['am-1', 'amen', 57, 60, 'A-men, a-men.'],
    ],
    loops: [],
  },
];

// ---------------------------------------------------------------------------------------------
// Helpers

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

function meterAt(def, m) {
  let beats = def.meters[0].beats;
  for (const mt of def.meters) if (m >= mt.from) beats = mt.beats;
  return beats;
}

function measureBeats(def, m) {
  if (m === def.measures.first && def.pickupBeats) return def.pickupBeats;
  return meterAt(def, m);
}

/** Start time of measure m on the plain tempo grid (no ritardando). */
function gridTime(def, m) {
  let beats = 0;
  for (let k = def.measures.first; k < m; k++) beats += measureBeats(def, k);
  return (def.leadIn || 0) + (beats * 60) / def.tempo;
}

function splitSyllables(hyphenated) {
  const out = [];
  for (const word of hyphenated.split(/\s+/)) {
    const parts = word.split('-');
    parts.forEach((text, i) => {
      let syllabic = 'single';
      if (parts.length > 1) syllabic = i === 0 ? 'begin' : i === parts.length - 1 ? 'end' : 'middle';
      out.push({ text, syllabic });
    });
  }
  return out;
}

const phraseText = (hyphenated) => hyphenated.replace(/(\S)-(\S)/g, '$1$2');

// Major scales by key signature (fifths), as [step, alter] from the tonic.
const SCALES = {
  '-3': [['E', -1], ['F', 0], ['G', 0], ['A', -1], ['B', -1], ['C', 0], ['D', 0]],
  '-1': [['F', 0], ['G', 0], ['A', 0], ['B', -1], ['C', 0], ['D', 0], ['E', 0]],
  1: [['G', 0], ['A', 0], ['B', 0], ['C', 0], ['D', 0], ['E', 0], ['F', 1]],
  2: [['D', 0], ['E', 0], ['F', 1], ['G', 0], ['A', 0], ['B', 0], ['C', 1]],
};
const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** Pitch for scale degree d (0 = the tonic in octave 3; may be negative or ≥ 7). */
function pitchOf(key, d) {
  const scale = SCALES[key];
  const octaveShift = Math.floor(d / 7);
  const [step, alter] = scale[((d % 7) + 7) % 7];
  // Octave numbers change at C: degrees past C in the scale belong to the next octave.
  const tonicIndex = STEP_INDEX[scale[0][0]];
  const octave = 3 + octaveShift + (STEP_INDEX[step] < tonicIndex ? 1 : 0);
  return { step, alter, octave };
}

// Rhythm patterns in eighths, by notes per measure, for each meter. The counts are chosen so the
// sample notation is about as dense as the real tenor scores (spec §6: about 4 measures across
// the landscape ribbon, about 3 in portrait).
const PATTERNS = {
  4: {
    3: [[4, 2, 2], [2, 2, 4], [3, 1, 4]],
    4: [[2, 2, 2, 2], [3, 1, 2, 2], [2, 2, 3, 1]],
    5: [[2, 1, 1, 2, 2], [1, 1, 2, 2, 2], [2, 2, 1, 1, 2]],
    6: [[2, 1, 1, 1, 1, 2], [1, 1, 2, 1, 1, 2], [1, 1, 1, 1, 2, 2]],
    7: [[1, 1, 1, 1, 1, 1, 2], [2, 1, 1, 1, 1, 1, 1], [1, 1, 2, 1, 1, 1, 1]],
    8: [[1, 1, 1, 1, 1, 1, 1, 1]],
  },
  3: {
    3: [[2, 2, 2], [3, 1, 2]],
    4: [[2, 1, 1, 2], [1, 1, 2, 2]],
    5: [[1, 1, 2, 1, 1], [2, 1, 1, 1, 1]],
    6: [[1, 1, 1, 1, 1, 1]],
  },
  1: { 1: [[2]] },
};
const MIN_NOTES = { 4: 8, 3: 6, 1: 1 };
const NOTE_TYPES = { 1: ['eighth', false], 2: ['quarter', false], 3: ['quarter', true], 4: ['half', false], 6: ['half', true], 8: ['whole', false] };

// ---------------------------------------------------------------------------------------------
// MusicXML

function buildMeasures(def) {
  const random = rng(def.seed);
  const { first, last } = def.measures;
  const restAt = new Map();
  for (const r of def.rests) for (let m = r.from; m <= r.to; m++) restAt.set(m, r);
  const notes = new Map(); // measure → [{dur, lyric?, pitch, slur?, ...}]

  let degree = 4; // the dominant above the tonic, a comfortable tenor starting point
  const lo = def.clef === 'bass' ? 1 : 0;
  const hi = def.clef === 'bass' ? 11 : 10;
  const step = () => {
    const r = random();
    const move = r < 0.15 ? -2 : r < 0.45 ? -1 : r < 0.6 ? 0 : r < 0.9 ? 1 : 2;
    degree = Math.min(Math.max(degree + move, lo), hi);
    return degree;
  };

  for (const [, , from, to, hyphenated] of def.lyrics) {
    const syllables = splitSyllables(hyphenated);
    const count = to - from + 1;
    const base = Math.floor(syllables.length / count);
    const extra = syllables.length % count;
    let s = 0;
    let previousSung = null;
    for (let j = 0; j < count; j++) {
      const m = from + j;
      const beats = measureBeats(def, m);
      const perMeasure = base + (j < extra ? 1 : 0);
      const isLast = j === count - 1;
      const options = PATTERNS[beats];
      const maxNotes = Math.max(...Object.keys(options).map(Number));
      const n = Math.min(Math.max(perMeasure, isLast ? 3 : MIN_NOTES[beats]), maxNotes);
      const choices = options[n];
      const pattern = choices[(m + def.seed) % choices.length];
      const sylNotes = new Set();
      for (let k = 0; k < perMeasure; k++) sylNotes.add(Math.floor((k * pattern.length) / perMeasure));
      const list = pattern.map((dur, k) => {
        // Each phrase ends on the tonic nearest the melody.
        const d = isLast && k === pattern.length - 1 ? (degree >= 4 ? 7 : 0) : step();
        const note = { dur, pitch: pitchOf(def.key, d) };
        if (sylNotes.has(k) && s < syllables.length) {
          note.lyric = syllables[s++];
          previousSung = note;
        } else if (previousSung) {
          // Melisma: the syllable continues under a slur.
          if (!previousSung.slurStart && !previousSung.inSlur) previousSung.slurStart = true;
          note.inSlur = true;
          previousSung.lastInSlur = note;
        }
        return note;
      });
      notes.set(m, list);
    }
  }

  // Close every slur on its last note.
  for (const list of notes.values()) for (const n of list) if (n.slurStart && n.lastInSlur) n.lastInSlur.slurStop = true;

  const measures = [];
  for (let m = first; m <= last; m++) {
    const beats = measureBeats(def, m);
    if (restAt.has(m) || !notes.has(m)) {
      measures.push({ number: m, beats, rest: true });
    } else {
      measures.push({ number: m, beats, notes: notes.get(m) });
    }
  }
  return measures;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function clefXml(clef) {
  return clef === 'bass'
    ? '<clef><sign>F</sign><line>4</line></clef>'
    : '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
}

function noteXml(n, def, m, isLastNoteOfMeasure, beamState) {
  const [type, dotted] = NOTE_TYPES[n.dur];
  const parts = [];
  parts.push('<note>');
  parts.push(`<pitch><step>${n.pitch.step}</step>${n.pitch.alter ? `<alter>${n.pitch.alter}</alter>` : ''}<octave>${n.pitch.octave}</octave></pitch>`);
  parts.push(`<duration>${n.dur}</duration><voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}`);
  if (beamState) parts.push(`<beam number="1">${beamState}</beam>`);
  const notations = [];
  if (n.slurStart) notations.push('<slur type="start" number="1"/>');
  if (n.slurStop) notations.push('<slur type="stop" number="1"/>');
  if (isLastNoteOfMeasure && def.fermatas && def.fermatas.includes(m)) notations.push('<fermata type="upright"/>');
  if (notations.length) parts.push(`<notations>${notations.join('')}</notations>`);
  if (n.lyric) parts.push(`<lyric number="1"><syllabic>${n.lyric.syllabic}</syllabic><text>${esc(n.lyric.text)}</text></lyric>`);
  parts.push('</note>');
  return parts.join('');
}

function beamStates(durs) {
  // Beam pairs of eighths that start on a beat.
  const states = durs.map(() => null);
  let pos = 0;
  for (let i = 0; i < durs.length; i++) {
    if (durs[i] === 1 && durs[i + 1] === 1 && pos % 2 === 0) {
      states[i] = 'begin';
      states[i + 1] = 'end';
    }
    pos += durs[i];
  }
  return states;
}

function musicXml(def, measures) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  lines.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  lines.push('<score-partwise version="4.0">');
  lines.push(`  <work><work-title>${esc(def.title)}</work-title></work>`);
  lines.push('  <identification>');
  lines.push('    <rights>Original placeholder material for the Choir Rehearsal sample songs.</rights>');
  lines.push('    <encoding><software>tools/generate-sample-content.mjs</software></encoding>');
  lines.push('  </identification>');
  lines.push('  <part-list>');
  lines.push(`    <score-part id="P1"><part-name>${esc(def.partName)}</part-name></score-part>`);
  lines.push('  </part-list>');
  lines.push('  <part id="P1">');
  let previousBeats = null;
  measures.forEach((ms, i) => {
    const implicit = i === 0 && def.pickupBeats ? ' implicit="yes"' : '';
    lines.push(`    <measure number="${ms.number}"${implicit}>`);
    const attrs = [];
    if (i === 0) attrs.push(`<divisions>${DIVISIONS}</divisions><key><fifths>${def.key}</fifths><mode>major</mode></key>`);
    const meter = meterAt(def, ms.number);
    if (i === 0 || meter !== previousBeats) {
      attrs.push(`<time><beats>${meter}</beats><beat-type>4</beat-type></time>`);
    }
    if (i === 0) attrs.push(clefXml(def.clef));
    if (attrs.length) lines.push(`      <attributes>${attrs.join('')}</attributes>`);
    previousBeats = meter;
    if (i === 0) {
      lines.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${def.tempo}</per-minute></metronome></direction-type><sound tempo="${def.tempo}"/></direction>`);
    }
    if (def.rit === ms.number) {
      lines.push('      <direction placement="above"><direction-type><words font-style="italic">rit.</words></direction-type></direction>');
    }
    if (ms.rest) {
      const restAttr = ms.number === def.measures.first && def.pickupBeats ? '' : ' measure="yes"';
      lines.push(`      <note><rest${restAttr}/><duration>${ms.beats * DIVISIONS}</duration><voice>1</voice></note>`);
    } else {
      const beams = beamStates(ms.notes.map((n) => n.dur));
      ms.notes.forEach((n, k) => lines.push(`      ${noteXml(n, def, ms.number, k === ms.notes.length - 1, beams[k])}`));
    }
    if (i === measures.length - 1) lines.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    lines.push('    </measure>');
  });
  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Song file

function anchorsFor(def) {
  if (def.anchors === 'none') return [];
  if (Array.isArray(def.anchors)) return def.anchors.map(([measure, time, source]) => ({ measure, time, source }));
  const starts = def.sections.map(([, , from]) => from);
  const list = starts.map((m) => ({ measure: m, time: round2(gridTime(def, m)), source: 'section' }));
  list.push({ measure: def.measures.last + 1, time: def.durationSeconds, source: 'terminal' });
  return list;
}

function songFile(def) {
  const song = {
    id: def.id,
    title: def.title,
    durationSeconds: def.durationSeconds,
    measures: def.measures,
    audio: `audio/${def.id}-tenor${def.line === 'Tenor 2' ? '2' : ''}.mp3`,
    score: {
      format: 'musicxml',
      src: `score/${def.id}-tenor${def.line === 'Tenor 2' ? '2' : ''}.musicxml`,
      partId: 'P1',
      ...(def.line ? { line: def.line } : {}),
    },
    sections: def.sections.map(([id, label, from, to]) => ({ id, label, from, to })),
    timing: { interpolation: def.interpolation, anchors: anchorsFor(def) },
    rests: def.rests,
    lyrics: def.lyrics.map(([id, section, from, to, text]) => ({ id, section, from, to, text: phraseText(text) })),
    loops: def.loops,
  };
  return song;
}

// ---------------------------------------------------------------------------------------------
// Audio

function measureStarts(def, song, xml) {
  const timeline = buildTimeline(song, { beats: readMeasureBeats(xml, 'P1') });
  const { first, last } = def.measures;
  const starts = [];
  for (let m = first; m <= last; m++) starts.push({ m, t: timeline ? timeline.measureStart(m) : gridTime(def, m) });
  return starts;
}

function renderPcm(def, song, starts) {
  const total = Math.round(def.durationSeconds * SAMPLE_RATE);
  const pcm = new Int16Array(total);
  const sectionStarts = new Set(song.sections.map((s) => s.from));
  const resting = (m) => song.rests.some((r) => m >= r.from && m <= r.to);
  for (const { m, t } of starts) {
    // Section starts ring highest, sung measures in the middle, tenor rests low and soft.
    const [freq, amp] = sectionStarts.has(m) ? [987.77, 0.5] : resting(m) ? [440, 0.22] : [659.26, 0.38];
    const begin = Math.round(t * SAMPLE_RATE);
    const length = Math.round(0.12 * SAMPLE_RATE);
    for (let i = 0; i < length && begin + i < total; i++) {
      const env = Math.min(1, i / 40) * Math.exp(-i / (0.035 * SAMPLE_RATE));
      const v = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * env * amp;
      pcm[begin + i] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
    }
  }
  return Buffer.from(pcm.buffer);
}

function encodeMp3(pcm, path) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '32k', '-map_metadata', '-1', '-id3v2_version', '0',
    '-fflags', '+bitexact', '-flags:a', '+bitexact', path,
  ];
  const r = spawnSync('ffmpeg', args, { input: pcm, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(`ffmpeg failed for ${path}: ${r.error ? r.error.message : r.stderr.toString()}`);
  }
}

// ---------------------------------------------------------------------------------------------

function main() {
  const withAudio = !process.argv.includes('--no-audio');
  for (const dir of ['songs', 'score', 'audio']) mkdirSync(OUT + dir, { recursive: true });

  const catalog = {
    catalogRevision: 'sample-2026-10-09.1',
    album: 'Tenor Choir · Fall 2026',
    songs: SONGS.map((d) => ({ id: d.id, src: `songs/${d.id}.json` })),
  };
  const catalogErrors = validateCatalog(catalog);
  if (catalogErrors.length) throw new Error(`catalog: ${catalogErrors.join('; ')}`);
  writeFileSync(OUT + 'catalog.json', formatSongJson(catalog));

  for (const def of SONGS) {
    const song = songFile(def);
    const v = validateSong(song, { expectedId: def.id });
    const problems = [...v.fatal, ...v.sync, ...v.score, ...v.warnings];
    if (problems.length) throw new Error(`${def.id}: ${problems.join('; ')}`);
    const xml = musicXml(def, buildMeasures(def));
    writeFileSync(OUT + `songs/${def.id}.json`, formatSongJson(song));
    writeFileSync(OUT + song.score.src, xml);
    if (withAudio) encodeMp3(renderPcm(def, song, measureStarts(def, song, xml)), OUT + song.audio);
    console.log(`${def.id}: ${song.measures.first}–${song.measures.last}, ${song.timing.anchors.length} anchors${withAudio ? ', audio' : ''}`);
  }
}

main();
