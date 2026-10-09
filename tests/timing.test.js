import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, uniformTime, notatedBeatsTime } from '../app/js/timing.js';
import { songOne, pickupSong, PICKUP_BEATS, clone } from './fixtures.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('a song without anchors has no timeline', () => {
  const song = songOne();
  song.timing.anchors = [];
  assert.equal(buildTimeline(song), null);
});

test('every printed measure gets a boundary, explicit at anchors and inferred between', () => {
  const tl = buildTimeline(songOne());
  assert.equal(tl.starts.length, 88 + 1);
  assert.equal(tl.measureStart(1), 0);
  assert.equal(tl.measureStart(9), 22.86);
  assert.equal(tl.measureStart(89), 258);
  assert.equal(tl.isExplicit(9), true);
  assert.equal(tl.isExplicit(5), false);
  assert.equal(tl.isExplicit(87), true);
  for (let m = 2; m <= 89; m++) assert.ok(tl.measureStart(m) > tl.measureStart(m - 1), `m. ${m} increases`);
});

test('uniform interpolation between anchors', () => {
  const tl = buildTimeline(songOne());
  close(tl.measureStart(5), 22.86 * (4 / 8));
  close(tl.measureStart(86), 240 + (1 / 2) * 7.5);
  close(tl.measureStart(88), 247.5 + (1 / 2) * 10.5);
  close(uniformTime(1, 0, 9, 22.86, 9), 22.86);
});

test('time-to-measure lookup at exact boundaries and between them', () => {
  const tl = buildTimeline(songOne());
  assert.equal(tl.measureAt(0), 1);
  assert.equal(tl.measureAt(22.859), 8);
  assert.equal(tl.measureAt(22.86), 9);
  assert.equal(tl.measureAt(22.861), 9);
  assert.equal(tl.measureAt(tl.measureStart(18)), 18);
  assert.equal(tl.measureAt(tl.measureStart(18) - 1e-6), 17);
  assert.equal(tl.measureAt(160), 57);
  assert.equal(tl.measureAt(159.99), 56);
});

test("lookup at and past the song's end stays on the last measure", () => {
  const tl = buildTimeline(songOne());
  assert.equal(tl.measureAt(257.99), 88);
  assert.equal(tl.measureAt(258), 88);
  assert.equal(tl.measureAt(400), 88);
  const p = tl.positionAt(258);
  assert.equal(p.measure, 88);
  assert.equal(p.afterEnd, true);
  assert.equal(p.measureProgress, 1);
  assert.equal(tl.measureEnd(88), 258);
});

test('a time before the first anchor clamps to the first measure', () => {
  const tl = buildTimeline(pickupSong('uniform'));
  const p = tl.positionAt(0.2);
  assert.equal(p.measure, 0);
  assert.equal(p.beforeStart, true);
  assert.equal(p.measureProgress, 0);
});

test('notated-beat interpolation weights measures by their written length', () => {
  close(notatedBeatsTime(0, 1, 5, 16, 1, (m) => PICKUP_BEATS.get(m)), 1 + (1 / 15) * 15);
  const tl = buildTimeline(pickupSong(), { beats: PICKUP_BEATS });
  assert.equal(tl.interpolation, 'notated-beats');
  // 15 beats over 15 s: one second per quarter note.
  close(tl.measureStart(0), 1);
  close(tl.measureStart(1), 2); // the pickup is one beat
  close(tl.measureStart(2), 6); // a 4/4 bar
  close(tl.measureStart(3), 8); // a 2/4 bar is half as long
  close(tl.measureStart(4), 12);
  close(tl.measureStart(5), 16);
});

test('a pickup at m. 0 under uniform interpolation counts as a whole measure', () => {
  const tl = buildTimeline(pickupSong('uniform'));
  close(tl.measureStart(1), 1 + 15 / 5);
  assert.equal(tl.measureAt(1.5), 0);
  assert.equal(tl.measureAt(4), 1);
});

test('notated-beats without MusicXML beats falls back to uniform spacing', () => {
  const tl = buildTimeline(pickupSong());
  assert.equal(tl.interpolation, 'uniform');
  assert.equal(tl.interpolationFallback, true);
  const partial = buildTimeline(pickupSong(), { beats: new Map([[0, 1], [1, 4]]) });
  assert.equal(partial.interpolationFallback, true);
});

test('explicit anchors always win over interpolation', () => {
  const song = pickupSong();
  song.timing.anchors.splice(1, 0, { measure: 3, time: 9.5, source: 'measure' });
  const tl = buildTimeline(song, { beats: PICKUP_BEATS });
  assert.equal(tl.measureStart(3), 9.5);
  // 0..3 is 7 beats over 8.5 s.
  close(tl.measureStart(1), 1 + (1 / 7) * 8.5);
  close(tl.measureStart(4), 9.5 + (4 / 8) * 6.5);
});

test('the terminal anchor ends the last measure and a loop on it ends at the song end', () => {
  const song = songOne();
  song.timing.anchors[song.timing.anchors.length - 1].time = 256; // music ends before the audio
  const tl = buildTimeline(song);
  assert.equal(tl.end, 256);
  assert.equal(tl.measureEnd(88), 256);
  assert.deepEqual(tl.loopRange({ from: 83, to: 88 }), { start: tl.measureStart(83), end: 258 });
  assert.equal(tl.positionAt(257).afterEnd, true);
});

test('anchors that skip the first or terminal measure are rejected', () => {
  const song = songOne();
  song.timing.anchors.pop();
  assert.throws(() => buildTimeline(song));
});

test('section and phrase lookup', () => {
  const tl = buildTimeline(songOne());
  const at = (m) => tl.positionAt(tl.measureStart(m) + 0.01);
  assert.equal(at(1).section.id, 'intro');
  assert.equal(at(18).section.label, 'Verse 1');
  assert.equal(at(18).phrase.id, 'v1-2');
  assert.equal(at(18).nextPhrase.id, 'v2-1');
  assert.equal(at(41).section.id, 'chorus');
  assert.equal(at(44).phrase.text, 'Carry me home, carry me home,');
  assert.equal(at(88).section.id, 'ending');
  assert.equal(at(88).phrase.id, 'end-1');
  assert.equal(at(88).nextPhrase, null);
});

test('a rest has no current phrase but knows the next one', () => {
  const tl = buildTimeline(songOne());
  const p = tl.positionAt(tl.measureStart(52) + 0.5);
  assert.equal(p.section.id, 'interlude');
  assert.equal(p.phrase, null);
  assert.equal(p.nextPhrase.id, 'br-1');
  const intro = tl.positionAt(0);
  assert.equal(intro.phrase, null);
  assert.equal(intro.nextPhrase.id, 'v1-1');
});

test('a gap between sections has no section', () => {
  const song = songOne();
  song.sections[4] = { id: 'interlude', label: 'Interlude', from: 50, to: 56 };
  const tl = buildTimeline(song);
  assert.equal(tl.positionAt(tl.measureStart(49) + 0.1).section, null);
});

test('rest countdown before, during and at the entrance', () => {
  const tl = buildTimeline(songOne());
  const at = (m, offset = 0.1) => tl.positionAt(tl.measureStart(m) + offset);
  assert.equal(at(48).rest, null, 'before the rest');
  assert.equal(at(49).rest.countdown, 8);
  assert.equal(at(52).rest.countdown, 5, 'spec §7 frame 4: m. 52 reads "Tenor enters in 5"');
  assert.equal(at(52).rest.entrance, 57);
  assert.equal(at(52).rest.measures, 8);
  assert.equal(at(56).rest.countdown, 1);
  // It counts down at each barline, not continuously.
  assert.equal(tl.positionAt(tl.measureEnd(55) - 0.001).rest.countdown, 2);
  assert.equal(tl.positionAt(tl.measureStart(56)).rest.countdown, 1);
  assert.equal(at(57, 0).rest, null, 'at the entrance');
  assert.equal(at(57, 0).measure, 57);
  assert.equal(at(1, 0).rest.countdown, 8, 'the intro rest from 0:00');
});

test('a rest that runs to the end has no countdown', () => {
  const tl = buildTimeline(pickupSong(), { beats: PICKUP_BEATS });
  const p = tl.positionAt(13);
  assert.equal(p.measure, 4);
  assert.equal(p.rest.entrance, null);
  assert.equal(p.rest.countdown, null);
});

test('loop boundaries: inclusive range to the start of the next measure', () => {
  const tl = buildTimeline(songOne());
  const r = tl.loopRange({ from: 55, to: 60 });
  assert.equal(r.start, tl.measureStart(55));
  assert.equal(r.end, tl.measureStart(61));
  assert.equal(tl.loopRange({ from: 83, to: 88 }).end, 258);
});

test('the position reports the applicable loop and whether time is inside it', () => {
  const song = songOne();
  const tl = buildTimeline(song);
  const loop = song.loops[0];
  const inside = tl.positionAt(tl.measureStart(57), { loop, status: 'active' });
  assert.equal(inside.loop.id, 'bridge-entrance');
  assert.equal(inside.loop.inside, true);
  assert.equal(inside.loop.status, 'active');
  const outside = tl.positionAt(10, { loop, status: 'suspended' });
  assert.equal(outside.loop.inside, false);
  assert.equal(outside.loop.status, 'suspended');
  assert.equal(tl.positionAt(10, { loop: null, status: 'off' }).loop, null);
});

test('section starts for the scrub bar ticks', () => {
  const tl = buildTimeline(songOne());
  const starts = tl.sectionStarts();
  assert.equal(starts.length, 8);
  assert.deepEqual(starts[1], { id: 'verse-1', label: 'Verse 1', measure: 9, time: 22.86 });
});

test('the timeline does not modify the song', () => {
  const song = songOne();
  const before = clone(song);
  buildTimeline(song).positionAt(100);
  assert.deepEqual(song, before);
});

test('progress through a measure range, for a merged multi-measure rest', () => {
  const tl = buildTimeline(songOne());
  assert.equal(tl.progressThrough(49, 56, tl.measureStart(49)), 0);
  close(tl.progressThrough(49, 56, tl.measureStart(53)), 0.5);
  assert.equal(tl.progressThrough(49, 56, tl.measureStart(57)), 1);
  assert.equal(tl.progressThrough(49, 56, 10), 0);
});
