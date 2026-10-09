import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopController } from '../app/js/loops.js';
import { buildTimeline } from '../app/js/timing.js';
import { songOne } from './fixtures.js';

const song = songOne();
const tl = buildTimeline(song);
const bridge = song.loops[0];
const range = tl.loopRange(bridge);

test('starting a loop seeks to its start unless playback is already inside it', () => {
  const c = createLoopController();
  assert.equal(c.start(bridge, range, 10), range.start);
  assert.equal(c.status, 'active');
  const d = createLoopController();
  assert.equal(d.start(bridge, range, range.start + 1), null);
});

test('reaching the end time wraps to the exact start', () => {
  const c = createLoopController();
  c.start(bridge, range, range.start);
  assert.equal(c.check(range.end - 0.01), null);
  assert.equal(c.check(range.end), range.start);
  assert.equal(c.check(range.end + 0.17), range.start, 'an overshoot still wraps');
});

test('wrapping is time-based, so it holds at every speed', () => {
  // The controller only compares currentTime with the range; the playback rate never enters.
  const c = createLoopController();
  c.start(bridge, range, range.start);
  for (const t of [range.end, range.end + 0.05, range.end + 0.3]) assert.equal(c.check(t), range.start);
});

test('a seek outside the loop suspends it until the next Play', () => {
  const c = createLoopController();
  c.start(bridge, range, range.start);
  c.userSeek(range.start + 2); // inside: stays active
  assert.equal(c.status, 'active');
  c.userSeek(5);
  assert.equal(c.status, 'suspended');
  assert.equal(c.check(range.end + 1), null, 'a suspended loop never wraps');
  c.userSeek(range.start + 1); // landing back inside doesn't resume it either
  assert.equal(c.status, 'suspended');
  assert.equal(c.play(), range.start, 'Play jumps back to the loop start');
  assert.equal(c.status, 'active');
  assert.equal(c.play(), null, 'Play while active seeks nowhere');
});

test('seeking to the end time counts as outside the inclusive range', () => {
  const c = createLoopController();
  c.start(bridge, range, range.start);
  c.userSeek(range.end);
  assert.equal(c.status, 'suspended');
});

test('ended wraps an active loop and ignores a suspended or stopped one', () => {
  const c = createLoopController();
  c.start(song.loops[1], tl.loopRange(song.loops[1]), 250);
  assert.equal(c.ended(), tl.measureStart(83));
  c.userSeek(0);
  assert.equal(c.ended(), null);
  c.stop();
  assert.equal(c.status, 'off');
  assert.equal(c.loop, null);
  assert.equal(c.ended(), null);
});
