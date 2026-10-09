import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, STORAGE_KEY, LEGACY_STORAGE_KEY, loadSettings, saveSettings, sanitizeSettings, launchState, normalizeSpeed, stepLyricsSize,
} from '../app/js/settings.js';
import { MemoryStorage } from './fixtures.js';

const ALLOWLIST = ['lastSongId', 'viewMode', 'speed', 'lyricsSize', 'repeat', 'forceLandscape', 'keepScreenOn', 'loopsEnabled', 'selectedLoops'];

test('defaults: Force landscape on, Loops off, Repeat off, Measure, 1.0×', () => {
  const s = loadSettings(new MemoryStorage());
  assert.equal(s.forceLandscape, true);
  assert.equal(s.keepScreenOn, true);
  assert.equal(s.loopsEnabled, false);
  assert.equal(s.repeat, 'off');
  assert.equal(s.viewMode, 'measure');
  assert.equal(s.speed, 1);
  assert.equal(s.lyricsSize, 22);
  assert.deepEqual(s.selectedLoops, {});
});

test('missing stored state falls back to defaults', () => {
  assert.deepEqual(loadSettings(new MemoryStorage()), { ...DEFAULTS, selectedLoops: {} });
  assert.deepEqual(loadSettings(null), { ...DEFAULTS, selectedLoops: {} });
});

test('corrupt stored state falls back to defaults', () => {
  for (const text of ['{not json', '[]', '"text"', '42', 'null']) {
    const s = loadSettings(new MemoryStorage({ [STORAGE_KEY]: text }));
    assert.deepEqual(s, { ...DEFAULTS, selectedLoops: {} }, text);
  }
});

test('a storage that throws falls back to defaults', () => {
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.deepEqual(loadSettings(broken), { ...DEFAULTS, selectedLoops: {} });
  assert.equal(saveSettings(broken, DEFAULTS), false);
});

test('each invalid value falls back individually', () => {
  const s = sanitizeSettings({
    lastSongId: 'Song One', viewMode: 'car', speed: 'fast', lyricsSize: 21, repeat: 'twice',
    forceLandscape: 'yes', keepScreenOn: 0, loopsEnabled: null, selectedLoops: { 'song-one': 7, BAD: 'x', 'song-two': 'final-hold' },
  });
  assert.equal(s.lastSongId, null);
  assert.equal(s.viewMode, 'measure');
  assert.equal(s.speed, 1);
  assert.equal(s.lyricsSize, 22);
  assert.equal(s.repeat, 'off');
  assert.equal(s.forceLandscape, true);
  assert.equal(s.keepScreenOn, true);
  assert.equal(s.loopsEnabled, false);
  assert.deepEqual(s.selectedLoops, { 'song-two': 'final-hold' });
});

test('speed snaps to 0.1× steps within 0.5–1.5×', () => {
  assert.equal(normalizeSpeed(0.2), 0.5);
  assert.equal(normalizeSpeed(2), 1.5);
  assert.equal(normalizeSpeed(1.26), 1.3);
  assert.equal(normalizeSpeed(0.7000001), 0.7);
  assert.equal(normalizeSpeed(NaN), null);
});

test('only the allowlisted settings are persisted', () => {
  const storage = new MemoryStorage();
  saveSettings(storage, {
    ...DEFAULTS,
    lastSongId: 'song-three',
    forceLandscape: false,
    speed: 1.3,
    selectedLoops: { 'song-one': 'bridge-entrance' },
    // None of these may be stored (spec §11).
    position: 81.2,
    currentTime: 81.2,
    activeLoop: 'bridge-entrance',
    playing: true,
    openSheet: 'settings',
  });
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(stored).sort(), ALLOWLIST.slice().sort());
  assert.equal(stored.lastSongId, 'song-three');
  assert.equal(stored.forceLandscape, false);
  assert.equal(stored.speed, 1.3);
  assert.deepEqual(stored.selectedLoops, { 'song-one': 'bridge-entrance' });
});

test('settings round-trip and Force landscape off persists', () => {
  const storage = new MemoryStorage();
  const s = { ...DEFAULTS, forceLandscape: false, repeat: 'all', viewMode: 'score-lyrics', lyricsSize: 26, loopsEnabled: true, selectedLoops: {} };
  saveSettings(storage, s);
  assert.deepEqual(loadSettings(storage), { ...s, lastSongId: null });
});

test('v1 settings carry over except the view, which opens on Measure once', () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({ lastSongId: 'song-two', viewMode: 'score-lyrics', speed: 0.8, forceLandscape: false }),
  });
  const s = loadSettings(storage);
  assert.equal(s.viewMode, 'measure');
  assert.equal(s.speed, 0.8);
  assert.equal(s.lastSongId, 'song-two');
  assert.equal(s.forceLandscape, false);
});

test('a v2 view choice is kept, and v1 is ignored once v2 exists', () => {
  const storage = new MemoryStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify({ viewMode: 'lyrics', speed: 0.6 }),
    [STORAGE_KEY]: JSON.stringify({ viewMode: 'score-lyrics' }),
  });
  const s = loadSettings(storage);
  assert.equal(s.viewMode, 'score-lyrics');
  assert.equal(s.speed, 1);
});

test('a corrupt v1 entry falls back to defaults', () => {
  for (const text of ['{not json', '[]', '42', 'null']) {
    assert.deepEqual(loadSettings(new MemoryStorage({ [LEGACY_STORAGE_KEY]: text })), { ...DEFAULTS, selectedLoops: {} }, text);
  }
});

test('relaunch: the last song at 0:00, paused, with no loop running', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify({ lastSongId: 'song-three', loopsEnabled: true, selectedLoops: { 'song-three': 'x' }, activeLoop: 'x', position: 99 }),
  });
  const settings = loadSettings(storage);
  const ids = ['song-one', 'song-two', 'song-three', 'song-four'];
  assert.deepEqual(launchState(settings, ids), { songIndex: 2, time: 0, playing: false, loop: null });
  assert.equal(settings.selectedLoops['song-three'], 'x', 'the selected loop is remembered');
  assert.equal('activeLoop' in settings, false);
  assert.equal('position' in settings, false);
});

test('relaunch with a song that no longer exists opens the first song', () => {
  const settings = sanitizeSettings({ lastSongId: 'gone' });
  assert.equal(launchState(settings, ['a', 'b']).songIndex, 0);
});

test('lyrics size steps through 18, 20, 22, 26, 30', () => {
  assert.equal(stepLyricsSize(22, 1), 26);
  assert.equal(stepLyricsSize(30, 1), 30);
  assert.equal(stepLyricsSize(18, -1), 18);
  assert.equal(stepLyricsSize(20, -1), 18);
});
