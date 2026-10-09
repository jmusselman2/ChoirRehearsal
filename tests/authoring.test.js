import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionTargets, measureTargets, createMarkSession, proposeRests, proposePhrases, buildSongFile, formatSongJson, loopId,
} from '../app/js/authoring.js';
import { readNotes } from '../app/js/score/measures.js';
import { validateSong } from '../app/js/content.js';
import { buildTimeline } from '../app/js/timing.js';
import { songOne, clone } from './fixtures.js';

const untimed = () => {
  const s = songOne();
  s.timing.anchors = [];
  return s;
};

test('section targets: the first measure and every section start', () => {
  assert.deepEqual(sectionTargets(songOne()), [1, 9, 25, 41, 49, 57, 73, 85]);
  const s = songOne();
  s.sections[0].from = 2; // a song whose first section starts after m. 1 still needs m. 1
  s.measures.first = 1;
  assert.deepEqual(sectionTargets(s).slice(0, 2), [1, 2]);
});

test('measure targets: an inclusive range clamped to the song', () => {
  assert.deepEqual(measureTargets(songOne(), 81, 88), [81, 82, 83, 84, 85, 86, 87, 88]);
  assert.deepEqual(measureTargets(songOne(), 90, 86), [86, 87, 88]);
});

test('a sections pass marks each section start in order, then the export adds the terminal anchor', () => {
  const song = untimed();
  const s = createMarkSession(song);
  assert.equal(s.next, 1);
  const times = [0.004, 22.861, 68.57, 114.29, 137.14, 160, 205.71, 240];
  for (const t of times) s.mark(t);
  assert.equal(s.next, null);
  assert.equal(s.mark(250), null, 'nothing left to mark');
  const anchors = s.anchors();
  assert.equal(anchors.length, 9);
  assert.deepEqual(anchors[0], { measure: 1, time: 0, source: 'section' });
  assert.deepEqual(anchors[1], { measure: 9, time: 22.86, source: 'section' }, 'stored to 0.01 s');
  assert.deepEqual(anchors.at(-1), { measure: 89, time: 258, source: 'terminal' });
  const file = buildSongFile(song, { anchors });
  assert.deepEqual(validateSong(file, { expectedId: 'song-one' }).sync, []);
  assert.ok(buildTimeline(file), 'the exported song builds a timeline');
});

test('a per-measure pass marks a range, can skip rest measures, and keeps section marks', () => {
  const s = createMarkSession(songOne());
  assert.equal(s.next, null, 'Song One already has every section anchor');
  s.setMeasuresMode(49, 58);
  assert.equal(s.next, 49);
  for (let i = 0; i < 8; i++) s.skip(); // the 8-measure interlude rest
  assert.equal(s.next, 57, 'the re-entry is the one to mark');
  s.mark(160.05);
  s.mark(162.9);
  const marks = s.marks();
  assert.deepEqual(marks.find((m) => m.measure === 58), { measure: 58, time: 162.9, source: 'measure' });
  assert.equal(marks.find((m) => m.measure === 57).time, 160.05);
  assert.equal(marks.find((m) => m.measure === 49).source, 'section');
});

test('nudge ±0.1 s, re-mark, remove and undo', () => {
  const s = createMarkSession(songOne());
  s.nudge(9, 0.1);
  assert.deepEqual(s.marks().find((m) => m.measure === 9), { measure: 9, time: 22.96, source: 'nudge' });
  s.nudge(9, -0.1);
  s.nudge(9, -0.1);
  assert.equal(s.marks().find((m) => m.measure === 9).time, 22.76);
  s.remark(25, 70);
  assert.equal(s.marks().find((m) => m.measure === 25).time, 70);
  s.remove(87);
  assert.equal(s.marks().some((m) => m.measure === 87), false);
  s.undo();
  assert.equal(s.marks().find((m) => m.measure === 87).time, 247.5);
  s.undo();
  assert.equal(s.marks().find((m) => m.measure === 25).time, 68.57);
  s.undo();
  s.undo();
  s.undo();
  assert.deepEqual(s.marks().find((m) => m.measure === 9), { measure: 9, time: 22.86, source: 'section' });
  assert.equal(s.canUndo, false);
});

test('undo moves the cursor back so the measure can be marked again', () => {
  const s = createMarkSession(untimed());
  s.mark(0);
  s.mark(23);
  assert.equal(s.next, 25);
  s.undo();
  assert.equal(s.next, 9);
  s.aim(41);
  assert.equal(s.next, 41);
});

test('out-of-order marks are reported', () => {
  const s = createMarkSession(untimed());
  s.mark(0);
  s.mark(30);
  s.mark(20);
  assert.deepEqual(s.outOfOrder(), [25]);
});

test('clearing starts a fresh pass', () => {
  const s = createMarkSession(songOne());
  s.clear();
  assert.deepEqual(s.marks(), []);
  assert.deepEqual(s.anchors(), []);
  assert.equal(s.next, 1);
});

const XML = (measures) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tenor</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const note = (lyric, syllabic = 'single') => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>${lyric === null ? '' : `<lyric number="1"><syllabic>${syllabic}</syllabic><text>${lyric}</text></lyric>`}</note>`;
const rest = (whole = false) => `<note><rest${whole ? ' measure="yes"' : ''}/><duration>8</duration></note>`;
const m = (n, ...notes) => `<measure number="${n}">${notes.join('')}</measure>`;

test('readNotes keeps pitch, rest and the first verse syllable, decoding entities', () => {
  const notes = readNotes(XML(m(1, note('God&apos;s', 'begin'), note(null), rest())), 'P1');
  assert.deepEqual(notes, [
    { measure: 1, rest: false, lyric: { text: "God's", syllabic: 'begin' } },
    { measure: 1, rest: false, lyric: null },
    { measure: 1, rest: true, lyric: null },
  ]);
});

test('rests are proposed from measures with no pitched notes', () => {
  const xml = XML([m(1, rest(true)), m(2, rest(true)), m(3, note('Sing')), m(4, rest(true)), m(5, note('on')), m(6, rest(true))].join(''));
  assert.deepEqual(proposeRests(readNotes(xml, 'P1'), 1, 6), [
    { from: 1, to: 2, entrance: 3 },
    { from: 4, to: 4, entrance: 5 },
    { from: 6, to: 6 },
  ]);
});

test('phrases join syllables into words and break at rests, sentence ends and sections', () => {
  const sections = [{ id: 'verse-1', from: 1, to: 4 }, { id: 'verse-2', from: 5, to: 8 }];
  const xml = XML([
    m(1, note('Mor', 'begin'), note('ning', 'end'), note('comes')),
    m(2, note('home.'), note(null)), // melisma, then a sentence end
    m(3, note('Rest'), note('here,')),
    m(4, rest(true)),
    m(5, note('Sing,'), note('sing')),
    m(6, note('a', 'begin'), note('loud', 'end')),
    m(7, note(null)),
    m(8, rest(true)),
  ].join(''));
  const phrases = proposePhrases(readNotes(xml, 'P1'), sections);
  assert.deepEqual(phrases, [
    { id: 'verse-1-1', section: 'verse-1', from: 1, to: 2, text: 'Morning comes home.' },
    { id: 'verse-1-2', section: 'verse-1', from: 3, to: 3, text: 'Rest here,' },
    { id: 'verse-2-1', section: 'verse-2', from: 5, to: 7, text: 'Sing, sing aloud' },
  ]);
});

test('a short phrase before a comma stays together; a long one breaks', () => {
  const sections = [{ id: 'v', from: 1, to: 20 }];
  const words = ['God', 'rest', 'ye', 'mer-', 'ry,', 'gen-', 'tle-', 'men', 'let', 'no-', 'thing', 'you', 'dis-', 'may.'];
  // God rest ye mer|ry, gen|tle|men let no|thing you dis|may. — one syllable per measure
  const syl = (w) => (w.endsWith('-') ? ['begin', w.slice(0, -1)] : null);
  let open = false;
  const ms = words.map((w, i) => {
    const s = syl(w);
    const syllabic = s ? (open ? 'middle' : 'begin') : open ? 'end' : 'single';
    open = !!s;
    return `<measure number="${i + 1}">${note(s ? s[1] : w, syllabic)}</measure>`;
  });
  const phrases = proposePhrases(readNotes(XML(ms.join('')), 'P1'), sections);
  assert.equal(phrases.length, 1, 'the comma after five syllables does not break');
  assert.equal(phrases[0].text, 'God rest ye merry, gentlemen let nothing you dismay.');
  const long = proposePhrases(readNotes(XML(ms.join('')), 'P1'), sections, { commaAfter: 4 });
  assert.equal(long.length, 2);
});

test('phrase proposals for the sample songs never overlap and pass validation', async () => {
  const { readFileSync } = await import('node:fs');
  for (const id of ['song-one', 'song-two', 'song-three', 'song-four']) {
    const song = JSON.parse(readFileSync(new URL(`../app/content.example/songs/${id}.json`, import.meta.url), 'utf8'));
    const xml = readFileSync(new URL(`../app/content.example/${song.score.src}`, import.meta.url), 'utf8');
    const notes = readNotes(xml, 'P1');
    const rests = proposeRests(notes, song.measures.first, song.measures.last);
    assert.deepEqual(rests, song.rests, `${id}: proposed rests match the authored ones`);
    const lyrics = proposePhrases(notes, song.sections);
    const file = buildSongFile(song, { rests, lyrics });
    assert.deepEqual(validateSong(file, { expectedId: id }).sync, [], id);
  }
});

test('the exported song keeps the spec key order and formats like the spec examples', () => {
  const song = clone(songOne());
  const file = buildSongFile(song, { loops: [], durationSeconds: 258.004 });
  assert.deepEqual(Object.keys(file), ['id', 'title', 'durationSeconds', 'measures', 'audio', 'score', 'sections', 'timing', 'rests', 'lyrics', 'loops']);
  assert.equal(file.durationSeconds, 258);
  const text = formatSongJson(file);
  assert.match(text, /\n {4}\{ "id": "intro", "label": "Intro", "from": 1, "to": 8 \},\n/);
  assert.deepEqual(JSON.parse(text), file);
});

test('loop ids come from the name and stay unique', () => {
  assert.equal(loopId('Bridge entrance', []), 'bridge-entrance');
  assert.equal(loopId('Bridge entrance', ['bridge-entrance']), 'bridge-entrance-2');
  assert.equal(loopId('  m. 81–88!  ', []), 'm-81-88');
});
