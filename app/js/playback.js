// The playback module: owns the one <audio> element, every transport command, Repeat, the
// practice-loop wrap and the Media Session (spec §11, §18). audio.currentTime is the only clock.
//
// It takes the audio element and Media Session as arguments rather than reading globals, so the
// command rules (the 3 s restart, Repeat, loop precedence) run under node --test with fakes.

import { createLoopController, LOOP_OFF } from './loops.js';
import { normalizeSpeed, REPEAT_MODES } from './settings.js';

export const SKIP_SECONDS = 5;
export const RESTART_THRESHOLD = 3;
export const ARTIST = 'Tenor rehearsal';
const END_EPSILON = 0.05;

/**
 * @param {object} options
 * @param {HTMLAudioElement} options.audio
 * @param {Array<{id: string, title: string, src: string|null}>} options.tracks  catalog order
 * @param {MediaSession|null} [options.mediaSession]
 * @param {typeof MediaMetadata|null} [options.MediaMetadata]
 * @param {string} options.album
 * @param {Array<object>} [options.artwork]
 * @param {number} [options.rate]
 * @param {'off'|'one'|'all'} [options.repeat]
 * @param {(reason: string) => void} [options.onChange]
 */
export function createPlayer({
  audio,
  tracks,
  mediaSession = null,
  MediaMetadata = null,
  album,
  artwork = [],
  rate = 1,
  repeat = 'off',
  onChange = () => {},
}) {
  const loops = createLoopController();
  let index = -1;
  let speed = normalizeSpeed(rate) ?? 1;
  let repeatMode = REPEAT_MODES.includes(repeat) ? repeat : 'off';
  let error = null;
  let metadataSets = 0;

  const duration = () => {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return tracks[index] && tracks[index].duration ? tracks[index].duration : 0;
  };
  const clamp = (t) => Math.min(Math.max(t, 0), duration() || Math.max(t, 0));
  const emit = (reason) => onChange(reason);

  function applyRate() {
    // The load algorithm resets both rates, so set them after every src change (spec §11).
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
  }

  function setMetadata(track) {
    if (!mediaSession || !MediaMetadata) return;
    try {
      mediaSession.metadata = new MediaMetadata({ title: track.title, artist: ARTIST, album, artwork });
      metadataSets++;
    } catch {
      // Metadata is best-effort; playback doesn't depend on it.
    }
  }

  function updatePositionState() {
    if (!mediaSession || typeof mediaSession.setPositionState !== 'function') return;
    const d = duration();
    if (!(d > 0)) return;
    try {
      mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || speed, position: Math.min(Math.max(audio.currentTime, 0), d) });
    } catch {
      // Older implementations reject some states; the system seek bar is optional.
    }
  }

  function startAudio() {
    if (!tracks[index] || !tracks[index].src) return;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => emit('play-rejected'));
  }

  // Seeks requested by the user. Landing outside an active loop suspends it.
  function userSeek(t) {
    const target = clamp(t);
    loops.userSeek(target);
    audio.currentTime = target;
    updatePositionState();
    emit('seek');
  }

  // Seeks the module makes itself (loop wrap, Play at the end); they never suspend a loop.
  function internalSeek(t) {
    audio.currentTime = t;
  }

  function load(i, { play = false } = {}) {
    const n = tracks.length;
    index = ((i % n) + n) % n;
    const track = tracks[index];
    loops.stop();
    error = null;
    if (track.src) {
      audio.src = track.src;
      applyRate();
      setMetadata(track);
    } else {
      // A song whose file failed to load: stop the previous track and offer nothing to play.
      audio.pause();
      audio.removeAttribute('src');
      if (typeof audio.load === 'function') audio.load();
      error = 'unavailable';
    }
    emit('track');
    if (play) startAudio();
  }

  function play() {
    const wrapTo = loops.play();
    if (wrapTo !== null) internalSeek(wrapTo);
    else if (audio.ended || (duration() > 0 && audio.currentTime >= duration() - END_EPSILON)) internalSeek(0);
    startAudio();
    emit('play');
  }

  function pause() {
    audio.pause();
    emit('pause');
  }

  function prev() {
    if (audio.currentTime > RESTART_THRESHOLD) userSeek(0);
    else load(index - 1, { play: true });
  }

  function next() {
    load(index + 1, { play: true });
  }

  function checkLoop() {
    const target = loops.check(audio.currentTime);
    if (target !== null) {
      internalSeek(target);
      emit('loop-wrap');
    }
  }

  function onEnded() {
    const wrapTo = loops.ended();
    if (wrapTo !== null) {
      // An active loop wins over every Repeat mode.
      internalSeek(wrapTo);
      startAudio();
      emit('loop-wrap');
      return;
    }
    if (repeatMode === 'one') {
      internalSeek(0);
      startAudio();
    } else if (repeatMode === 'all') {
      load(index + 1, { play: true });
    } else if (index < tracks.length - 1) {
      load(index + 1, { play: true });
    } else {
      emit('stopped'); // Repeat Off: the end of the last song stops.
    }
  }

  audio.addEventListener('timeupdate', () => { checkLoop(); emit('time'); });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('loadedmetadata', () => {
    if (audio.playbackRate !== speed) applyRate();
    updatePositionState();
    emit('metadata');
  });
  audio.addEventListener('ratechange', () => { updatePositionState(); emit('rate'); });
  audio.addEventListener('seeked', () => { updatePositionState(); emit('seeked'); });
  audio.addEventListener('play', () => { if (mediaSession) mediaSession.playbackState = 'playing'; updatePositionState(); emit('playing'); });
  audio.addEventListener('pause', () => { if (mediaSession) mediaSession.playbackState = 'paused'; updatePositionState(); emit('paused'); });
  audio.addEventListener('error', () => { error = 'audio'; emit('error'); });

  const handlers = {
    play: () => play(),
    pause: () => pause(),
    previoustrack: () => prev(),
    nexttrack: () => next(),
    // Android sends no seekOffset, so the app's 5 s always applies (spec §18).
    seekbackward: () => userSeek(audio.currentTime - SKIP_SECONDS),
    seekforward: () => userSeek(audio.currentTime + SKIP_SECONDS),
    seekto: (details) => {
      if (!details || typeof details.seekTime !== 'number') return;
      userSeek(details.seekTime);
    },
  };
  const wiredActions = [];
  if (mediaSession) {
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        mediaSession.setActionHandler(action, handler);
        wiredActions.push(action);
      } catch {
        // An action this browser doesn't support.
      }
    }
  }

  return {
    load,
    play,
    pause,
    toggle: () => (audio.paused ? play() : pause()),
    seek: (t) => userSeek(t),
    skip: (seconds) => userSeek(audio.currentTime + seconds),
    prev,
    next,
    select: (i) => load(i, { play: true }),
    retry: () => load(index, { play: false }),
    /** Called from the view's animation frame for tighter loop wraps while visible. */
    tick: checkLoop,

    setRate(r) {
      const v = normalizeSpeed(r);
      if (v === null) return speed;
      speed = v;
      applyRate();
      updatePositionState();
      emit('rate');
      return speed;
    },
    setRepeat(mode) {
      if (REPEAT_MODES.includes(mode)) repeatMode = mode;
      emit('repeat');
    },

    /** Starts a loop: seeks to its start unless already inside, and plays (spec §9). */
    startLoop(loop, range) {
      const target = loops.start(loop, range, audio.currentTime);
      if (target !== null) internalSeek(target);
      startAudio();
      emit('loop');
    },
    stopLoop() {
      loops.stop();
      emit('loop');
    },

    get index() { return index; },
    get track() { return tracks[index] || null; },
    get tracks() { return tracks; },
    get rate() { return speed; },
    get repeat() { return repeatMode; },
    get loopState() { return loops.state; },
    get loopActive() { return loops.status !== LOOP_OFF; },
    get error() { return error; },
    get metadataSets() { return metadataSets; },
    get mediaActions() { return wiredActions.slice(); },
    /** A snapshot of what the audio element reports. */
    get state() {
      return {
        index,
        playing: !audio.paused,
        time: audio.currentTime,
        duration: duration(),
        rate: speed,
        repeat: repeatMode,
        loop: loops.state,
        error,
      };
    },
  };
}
