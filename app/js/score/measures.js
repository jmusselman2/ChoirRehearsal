// Reads each printed measure's notated length from MusicXML, in quarter-note beats, for
// "notated-beats" interpolation (spec §12): a 2/4 bar counts 2, a 3/4 bar 3, a pickup only its
// written length. Plain string scanning, no DOM, so it runs under node --test as well.

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

/**
 * @param {string} xml  a score-partwise MusicXML document
 * @param {string} [partId]  the part to read; defaults to the first part
 * @returns {Map<number, number>} printed measure number → length in quarter-note beats
 */
export function readMeasureBeats(xml, partId) {
  let partBody = null;
  PART_RE.lastIndex = 0;
  for (let m = PART_RE.exec(xml); m; m = PART_RE.exec(xml)) {
    if (!partId || m[1] === partId) { partBody = m[2]; break; }
  }
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
