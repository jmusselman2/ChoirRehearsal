import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneStaffScale, stepScale, SCALE_MAX } from '../app/js/score/staff-size.js';

test('the Pixel 7 gets a 1.4× staff', () => {
  assert.equal(phoneStaffScale(486, 1079), 1.4);
});

test('one size per phone, whichever way it is held', () => {
  for (const [w, h] of [[486, 1079], [412, 915], [360, 800], [430, 932]]) {
    assert.equal(phoneStaffScale(w, h), phoneStaffScale(h, w), `${w}×${h}`);
  }
});

test('smaller phones never go below the 30 px staff', () => {
  assert.equal(phoneStaffScale(412, 915), 1);
  assert.equal(phoneStaffScale(360, 800), 1);
  assert.equal(phoneStaffScale(320, 568), 1);
});

test('a big screen stops at the maximum', () => {
  assert.equal(phoneStaffScale(1080, 1920), SCALE_MAX);
});

test('an unknown screen falls back to the 30 px staff', () => {
  assert.equal(phoneStaffScale(0, 0), 1);
  assert.equal(phoneStaffScale(undefined, undefined), 1);
});

test('sizes round down to 5% steps within 1–1.6×', () => {
  assert.equal(stepScale(1.449), 1.4);
  assert.equal(stepScale(1.45), 1.45);
  assert.equal(stepScale(1.15), 1.15);
  assert.equal(stepScale(0.7), 1);
  assert.equal(stepScale(3), SCALE_MAX);
});
