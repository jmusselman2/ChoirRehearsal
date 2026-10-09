// Reads what the timing and setup tools need from MusicXML: each printed measure's notated length
// in quarter-note beats, for "notated-beats" interpolation (spec §12: a 2/4 bar counts 2, a 3/4
// bar 3, a pickup only its written length), and the notes with their lyric syllables, for the
// setup page's rest and phrase proposals. Plain string scanning, no DOM, so it runs under
// node --test as well.

const MEASURE_RE = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/g;
const PART_RE = /<part\b[^>]*\bid\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/part>/g;
const EVENT_RE = /<(divisions|note|backup|forward)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g;

const attr = (attrs, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};
const childNumber = (body, tag) => {
  const m = new RegExp(`<${tag}\\b[^>]*>\\s*([0-9.]+)\\s*</${tag}>`).exec(body);
  return m ? Number(m[1]) : null;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) => text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? whole;
});

function partBodyOf(xml, partId) {
  PART_RE.lastIndex = 0;
  for (let m = PART_RE.exec(xml); m; m = PART_RE.exec(xml)) {
    if (!partId || m[1] === partId) return m[2];
  }
  return null;
}

/**
 * @param {string} xml  a score-partwise MusicXML document
 * @param {string} [partId]  the part to read; defaults to the first part
 * @returns {Map<number, number>} printed measure number → length in quarter-note beats
 */
export function readMeasureBeats(xml, partId) {
  const partBody = partBodyOf(xml, partId);
  const beats = new Map();
  if (partBody === null) return beats;

  let divisions = 1;
  MEASURE_RE.lastIndex = 0;
  for (let mm = MEASURE_RE.exec(partBody); mm; mm = MEASURE_RE.exec(partBody)) {
    const number = Number.parseInt(attr(mm[1], 'number'), 10);
    const body = mm[2];
    let cursor = 0;
    let longest = 0;
    let lastNoteStart = 0;
    EVENT_RE.lastIndex = 0;
    for (let ev = EVENT_RE.exec(body); ev; ev = EVENT_RE.exec(body)) {
      const [, tag, inner = ''] = ev;
      if (tag === 'divisions') {
        const d = Number(inner.trim());
        if (d > 0) divisions = d;
        continue;
      }
      const duration = childNumber(inner, 'duration') || 0;
      if (tag === 'backup') cursor -= duration;
      else if (tag === 'forward') cursor += duration;
      else if (/<grace\b/.test(inner)) continue;
      else if (/<chord\s*\/>/.test(inner)) {
        // A chord tone starts with the previous note and doesn't advance the cursor.
        longest = Math.max(longest, lastNoteStart + duration);
        continue;
      } else {
        lastNoteStart = cursor;
        cursor += duration;
      }
      longest = Math.max(longest, cursor);
    }
    if (Number.isInteger(number)) beats.set(number, longest / divisions);
  }
  return beats;
}

/**
 * The part's notes in document order, for proposing rests and lyric phrases.
 *
 * @returns {Array<{measure: number, rest: boolean, lyric: {text: string, syllabic: string}|null}>}
 *   Chord tones and grace notes are skipped; lyric is the first verse's syllable, if any.
 */
export function readNotes(xml, partId) {
  const partBody = partBodyOf(xml, partId);
  const notes = [];
  if (partBody === null) return notes;
  const measureRe = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/g;
  for (let mm = measureRe.exec(partBody); mm; mm = measureRe.exec(partBody)) {
    const measure = Number.parseInt(attr(mm[1], 'number'), 10);
    const noteRe = /<note\b[^>]*>([\s\S]*?)<\/note>/g;
    for (let n = noteRe.exec(mm[2]); n; n = noteRe.exec(mm[2])) {
      const inner = n[1];
      if (/<grace\b/.test(inner) || /<chord\s*\/>/.test(inner)) continue;
      const lyricMatch = /<lyric\b[^>]*>([\s\S]*?)<\/lyric>/.exec(inner);
      let lyric = null;
      if (lyricMatch) {
        const text = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(lyricMatch[1]);
        const syllabic = /<syllabic>\s*([a-z]+)\s*<\/syllabic>/.exec(lyricMatch[1]);
        if (text) lyric = { text: decode(text[1].trim()), syllabic: syllabic ? syllabic[1] : 'single' };
      }
      notes.push({ measure, rest: /<rest\b/.test(inner), lyric });
    }
  }
  return notes;
}
