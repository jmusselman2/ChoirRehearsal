import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrientation } from '../app/js/orientation.js';

function env({ lockResult = 'resolve', fullscreen = null, standalone = false } = {}) {
  const calls = [];
  const document = new EventTarget();
  document.fullscreenElement = fullscreen;
  document.documentElement = {
    requestFullscreen: async () => { calls.push('requestFullscreen'); document.fullscreenElement = document.documentElement; },
  };
  document.exitFullscreen = async () => { calls.push('exitFullscreen'); document.fullscreenElement = null; };
  const screen = {
    orientation: {
      lock: async (o) => {
        calls.push(`lock:${o}`);
        if (lockResult === 'reject') throw new DOMException('Not supported', 'NotSupportedError');
      },
      unlock: () => { calls.push('unlock'); },
    },
  };
  const matchMedia = () => ({ matches: standalone });
  return { calls, document, screen, matchMedia };
}

test('the launch request locks to landscape without fullscreen', async () => {
  const e = env();
  const o = createOrientation(e);
  assert.equal(await o.apply(true), true);
  assert.deepEqual(e.calls, ['lock:landscape']);
});

test('a refused lock resolves quietly so the music shows in the current orientation', async () => {
  const e = env({ lockResult: 'reject' });
  const o = createOrientation(e);
  assert.equal(await o.apply(true), false);
  assert.deepEqual(e.calls, ['lock:landscape']);
});

test('an unsupported browser resolves quietly', async () => {
  const o = createOrientation({ screen: {}, document: new EventTarget() });
  assert.equal(await o.apply(true), false);
  assert.equal(await o.apply(false), false);
});

test('a user-triggered request may enter fullscreen first', async () => {
  const e = env();
  const o = createOrientation(e);
  assert.equal(await o.apply(true, { userInitiated: true }), true);
  assert.deepEqual(e.calls, ['requestFullscreen', 'lock:landscape']);
  assert.equal(o.appFullscreen, true);
});

test('an installed app is not taken fullscreen', async () => {
  const e = env({ standalone: true });
  const o = createOrientation(e);
  await o.apply(true, { userInitiated: true });
  assert.deepEqual(e.calls, ['lock:landscape']);
});

test('if the lock is refused after entering fullscreen, the app leaves its own fullscreen', async () => {
  const e = env({ lockResult: 'reject' });
  const o = createOrientation(e);
  assert.equal(await o.apply(true, { userInitiated: true }), false);
  assert.deepEqual(e.calls, ['requestFullscreen', 'lock:landscape', 'unlock', 'exitFullscreen']);
});

test('turning the setting off unlocks immediately and exits the fullscreen the app opened', async () => {
  const e = env();
  const o = createOrientation(e);
  await o.apply(true, { userInitiated: true });
  e.calls.length = 0;
  await o.apply(false);
  assert.deepEqual(e.calls, ['unlock', 'exitFullscreen']);
  assert.equal(o.appFullscreen, false);
});

test("turning it off never exits a fullscreen the user opened", async () => {
  const e = env();
  const o = createOrientation(e);
  e.document.fullscreenElement = {}; // the user went fullscreen themselves
  await o.apply(true, { userInitiated: true });
  e.calls.length = 0;
  await o.apply(false);
  assert.deepEqual(e.calls, ['unlock']);
});

test('leaving fullscreen by hand clears the app-fullscreen flag', async () => {
  const e = env();
  const o = createOrientation(e);
  await o.apply(true, { userInitiated: true });
  e.document.fullscreenElement = null;
  e.document.dispatchEvent(new Event('fullscreenchange'));
  e.calls.length = 0;
  await o.apply(false);
  assert.deepEqual(e.calls, ['unlock']);
});

test('a refused fullscreen request still attempts the lock', async () => {
  const e = env();
  e.document.documentElement.requestFullscreen = async () => { e.calls.push('requestFullscreen'); throw new TypeError('Permissions check failed'); };
  const o = createOrientation(e);
  assert.equal(await o.apply(true, { userInitiated: true }), true);
  assert.deepEqual(e.calls, ['requestFullscreen', 'lock:landscape']);
  assert.equal(o.appFullscreen, false);
});
