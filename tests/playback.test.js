import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, SKIP_SECONDS, ARTIST } from '../app/js/playback.js';
import { buildTimeline } from '../app/js/timing.js';
import { FakeAudio, FakeMediaSession, FakeMediaMetadata, songOne } from './fixtures.js';

const TRACKS = [
  { id: 'song-one', title: 'Song One', src: 'a1.mp3', duration: 258 },
  { id: 'song-two', title: 'Song Two', src: 'a2.mp3', duration: 185 },
  { id: 'song-three', title: 'Song Three', src: 'a3.mp3', duration: 167 },
  { id: 'song-four', title: 'Song Four', src: 'a4.mp3', duration: 212 },
];

function setup(options = {}) {
  const audio = new FakeAudio();
  const mediaSession = new FakeMediaSession();
  const reasons = [];
  const player = createPlayer({
    audio,
    tracks: TRACKS,
    mediaSession,
    MediaMetadata: FakeMediaMetadata,
    album: 'Tenor Choir · Fall 2026',
    artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    onChange: (r) => reasons.push(r),
    ...options,
  });
  return { audio, mediaSession, player, reasons };
}

test('loading a song at launch stays paused at 0:00', () => {
  const { audio, player } = setup();
  player.load(2);
  assert.equal(player.index, 2);
  assert.equal(audio.src, 'a3.mp3');
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCalls, 0, 'never autoplay');
  assert.equal(player.state.playing, false);
  assert.equal(player.loopActive, false);
});

test('play and pause', () => {
  const { audio, player } = setup();
  player.load(0);
  player.play();
  assert.equal(audio.paused, false);
  audio.advance(40);
  player.pause();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 40, 'pause keeps the position');
  player.toggle();
  assert.equal(audio.paused, false);
});

test('Play at the end seeks to 0 first', () => {
  const { audio, player } = setup();
  player.load(3);
  audio.loaded(212);
  audio.currentTime = 212;
  audio.ended = true;
  player.play();
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
});

test('skip ±5 s and clamp to the song', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  audio.currentTime = 100;
  player.skip(SKIP_SECONDS);
  assert.equal(audio.currentTime, 105);
  player.skip(-SKIP_SECONDS);
  assert.equal(audio.currentTime, 100);
  audio.currentTime = 2;
  player.skip(-5);
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 256;
  player.skip(5);
  assert.equal(audio.currentTime, 258);
  player.seek(-10);
  assert.equal(audio.currentTime, 0);
  player.seek(9999);
  assert.equal(audio.currentTime, 258);
});

test('speed 0.5–1.5× sets both rates, keeps pitch, and survives a song change', () => {
  const { audio, player } = setup();
  player.load(0);
  assert.equal(player.setRate(1.3), 1.3);
  assert.equal(audio.playbackRate, 1.3);
  assert.equal(audio.defaultPlaybackRate, 1.3);
  assert.equal(audio.preservesPitch, true);
  player.next(); // the FakeAudio resets rates on src, like the load algorithm
  assert.equal(audio.playbackRate, 1.3);
  assert.equal(audio.defaultPlaybackRate, 1.3);
  assert.equal(player.setRate(3), 1.5);
  assert.equal(player.setRate(0.1), 0.5);
});

test('⏮ restarts the song when more than 3 s in', () => {
  const { audio, player } = setup();
  player.load(1);
  player.play();
  audio.advance(3.5);
  player.prev();
  assert.equal(player.index, 1);
  assert.equal(audio.currentTime, 0);
});

test('⏮ within the first 3 s goes to the previous song, wrapping, and plays it', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.advance(3);
  player.prev();
  assert.equal(player.index, 3, 'wraps from the first song to the last');
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
  player.prev();
  assert.equal(player.index, 2);
});

test('⏭ goes to the next song, wrapping from the last to the first, and plays from 0:00', () => {
  const { audio, player } = setup();
  player.load(3);
  audio.advance(50);
  player.next();
  assert.equal(player.index, 0);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
});

test('selecting a song starts it from 0:00', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.advance(30);
  player.select(2);
  assert.equal(player.index, 2);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
});

test('Repeat Off plays the next song and stops after the last', () => {
  const { audio, player, reasons } = setup({ repeat: 'off' });
  player.load(2);
  player.play();
  audio.loaded(167);
  audio.finish();
  assert.equal(player.index, 3);
  assert.equal(audio.paused, false);
  audio.loaded(212);
  audio.finish();
  assert.equal(player.index, 3, 'stays on the last song');
  assert.equal(audio.paused, true);
  assert.equal(reasons.at(-1), 'stopped');
});

test('Repeat This song restarts the song', () => {
  const { audio, player } = setup({ repeat: 'one' });
  player.load(1);
  player.play();
  audio.loaded(185);
  audio.finish();
  assert.equal(player.index, 1);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
});

test('Repeat All songs plays the next song, wrapping', () => {
  const { audio, player } = setup({ repeat: 'all' });
  player.load(3);
  player.play();
  audio.loaded(212);
  audio.finish();
  assert.equal(player.index, 0);
  assert.equal(audio.paused, false);
  player.setRepeat('off');
  assert.equal(player.repeat, 'off');
});

// ---- Loops -----------------------------------------------------------------------------------

const song = songOne();
const tl = buildTimeline(song);
const bridge = song.loops[0];
const finalHold = song.loops[1];

test('selecting a loop seeks to its start and plays; reaching its end wraps', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  const range = tl.loopRange(bridge);
  player.startLoop(bridge, range);
  assert.equal(audio.currentTime, range.start);
  assert.equal(audio.paused, false);
  audio.advance(range.end + 0.15);
  assert.equal(audio.currentTime, range.start, 'timeupdate wraps to the exact start');
  audio.currentTime = range.end + 0.01;
  player.tick();
  assert.equal(audio.currentTime, range.start, 'the animation-frame check wraps too');
});

test('a seek outside the loop suspends it until the next Play', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  const range = tl.loopRange(bridge);
  player.startLoop(bridge, range);
  player.seek(10);
  assert.equal(player.loopState.status, 'suspended');
  audio.advance(range.end + 1);
  assert.equal(audio.currentTime, range.end + 1, 'no wrap while suspended');
  player.pause();
  player.play();
  assert.equal(audio.currentTime, range.start, 'Play jumps back to the loop start');
  assert.equal(player.loopState.status, 'active');
});

test('a skip that lands outside the loop suspends it too', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  const range = tl.loopRange(bridge);
  player.startLoop(bridge, range);
  player.skip(-5);
  assert.equal(player.loopState.status, 'suspended');
});

test('an active loop wins over every Repeat mode', () => {
  for (const repeat of ['off', 'one', 'all']) {
    const { audio, player } = setup({ repeat });
    player.load(0);
    audio.loaded(258);
    const range = tl.loopRange(finalHold);
    player.startLoop(finalHold, range);
    audio.finish();
    assert.equal(player.index, 0, `${repeat}: stays on the song`);
    assert.equal(audio.currentTime, range.start, `${repeat}: wraps to the loop start`);
    assert.equal(audio.paused, false);
  }
});

test('a suspended loop does not override Repeat', () => {
  const { audio, player } = setup({ repeat: 'all' });
  player.load(0);
  audio.loaded(258);
  player.startLoop(bridge, tl.loopRange(bridge));
  player.seek(250);
  audio.finish();
  assert.equal(player.index, 1);
});

test('changing songs stops the active loop', () => {
  for (const change of ['next', 'prev', 'select', 'mediaNext']) {
    const { audio, player, mediaSession } = setup();
    player.load(0);
    audio.loaded(258);
    player.startLoop(bridge, tl.loopRange(bridge));
    if (change === 'select') player.select(2);
    else if (change === 'mediaNext') mediaSession.handlers.nexttrack();
    else {
      audio.currentTime = 1; // within 3 s so ⏮ changes songs
      player[change]();
    }
    assert.equal(player.loopActive, false, change);
    assert.equal(player.loopState.loop, null, change);
  }
});

test('⏮ restart with an active loop is a seek outside it', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  player.startLoop(bridge, tl.loopRange(bridge));
  player.prev();
  assert.equal(player.index, 0);
  assert.equal(player.loopState.status, 'suspended');
});

test('stopping a loop leaves playback where it is', () => {
  const { audio, player } = setup();
  player.load(0);
  audio.loaded(258);
  const range = tl.loopRange(bridge);
  player.startLoop(bridge, range);
  audio.advance(range.start + 3);
  player.stopLoop();
  assert.equal(player.loopActive, false);
  audio.advance(range.end + 1);
  assert.equal(audio.currentTime, range.end + 1);
});

// ---- Media Session ---------------------------------------------------------------------------

test('Media Session metadata is set once per track', () => {
  const { audio, player, mediaSession } = setup();
  player.load(0);
  assert.equal(player.metadataSets, 1);
  assert.deepEqual(
    { title: mediaSession.metadata.title, artist: mediaSession.metadata.artist, album: mediaSession.metadata.album },
    { title: 'Song One', artist: ARTIST, album: 'Tenor Choir · Fall 2026' },
  );
  const first = mediaSession.metadata;
  player.play();
  audio.loaded(258);
  player.seek(40);
  player.skip(5);
  audio.advance(50);
  player.setRate(1.2);
  player.startLoop(bridge, tl.loopRange(bridge));
  audio.advance(tl.loopRange(bridge).end);
  player.pause();
  assert.equal(player.metadataSets, 1, 'never changes during a track');
  assert.equal(mediaSession.metadata, first);
  player.next();
  assert.equal(player.metadataSets, 2);
  assert.equal(mediaSession.metadata.title, 'Song Two');
});

test('every Media Session action handler is wired', () => {
  const { player, mediaSession } = setup();
  const required = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'];
  assert.deepEqual(player.mediaActions.sort(), required.slice().sort());
  for (const a of required) assert.equal(typeof mediaSession.handlers[a], 'function', a);
});

test('lock-screen actions behave like the in-app commands', () => {
  const { audio, player, mediaSession } = setup();
  const h = mediaSession.handlers;
  player.load(0);
  audio.loaded(258);
  h.play();
  assert.equal(audio.paused, false);
  assert.equal(mediaSession.playbackState, 'playing');
  h.pause();
  assert.equal(audio.paused, true);
  assert.equal(mediaSession.playbackState, 'paused');
  audio.currentTime = 100;
  h.seekbackward({ seekOffset: 10 });
  assert.equal(audio.currentTime, 95, 'always the app’s 5 s');
  h.seekforward({});
  assert.equal(audio.currentTime, 100);
  h.seekto({ seekTime: 42 });
  assert.equal(audio.currentTime, 42);
  h.previoustrack(); // more than 3 s in: restart
  assert.equal(player.index, 0);
  assert.equal(audio.currentTime, 0);
  h.previoustrack(); // at the start: previous song, wrapping
  assert.equal(player.index, 3);
  h.nexttrack();
  assert.equal(player.index, 0);
  assert.ok(mediaSession.positionStates.length > 0, 'the system seek bar gets position updates');
});

test('a song that failed to load reports unavailable instead of playing', () => {
  const audio = new FakeAudio();
  const tracks = [TRACKS[0], { id: 'broken', title: 'Broken', src: null }];
  const player = createPlayer({ audio, tracks, album: 'x' });
  player.load(0);
  player.play();
  player.select(1);
  assert.equal(player.error, 'unavailable');
  assert.equal(audio.paused, true);
});

test('works without a Media Session', () => {
  const audio = new FakeAudio();
  const player = createPlayer({ audio, tracks: TRACKS, album: 'x' });
  player.load(0);
  player.play();
  assert.deepEqual(player.mediaActions, []);
});
