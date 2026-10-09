// Test fixtures. Song One is the placeholder song from spec §10 and §15.

export function songOne() {
  return {
    id: 'song-one',
    title: 'Song One',
    durationSeconds: 258.0,
    measures: { first: 1, last: 88 },
    audio: 'audio/song-one-tenor.mp3',
    score: { format: 'musicxml', src: 'score/song-one-tenor.musicxml', partId: 'P1' },
    sections: [
      { id: 'intro', label: 'Intro', from: 1, to: 8 },
      { id: 'verse-1', label: 'Verse 1', from: 9, to: 24 },
      { id: 'verse-2', label: 'Verse 2', from: 25, to: 40 },
      { id: 'chorus', label: 'Chorus', from: 41, to: 48 },
      { id: 'interlude', label: 'Interlude', from: 49, to: 56 },
      { id: 'bridge', label: 'Bridge', from: 57, to: 72 },
      { id: 'final-chorus', label: 'Final chorus', from: 73, to: 84 },
      { id: 'ending', label: 'Ending', from: 85, to: 88 },
    ],
    timing: {
      interpolation: 'uniform',
      anchors: [
        { measure: 1, time: 0.0, source: 'section' },
        { measure: 9, time: 22.86, source: 'section' },
        { measure: 25, time: 68.57, source: 'section' },
        { measure: 41, time: 114.29, source: 'section' },
        { measure: 49, time: 137.14, source: 'section' },
        { measure: 57, time: 160.0, source: 'measure' },
        { measure: 73, time: 205.71, source: 'section' },
        { measure: 85, time: 240.0, source: 'section' },
        { measure: 87, time: 247.5, source: 'measure' },
        { measure: 89, time: 258.0, source: 'terminal' },
      ],
    },
    rests: [
      { from: 1, to: 8, entrance: 9 },
      { from: 49, to: 56, entrance: 57 },
    ],
    lyrics: [
      { id: 'v1-1', section: 'verse-1', from: 9, to: 16, text: 'Morning comes across the river,' },
      { id: 'v1-2', section: 'verse-1', from: 17, to: 24, text: 'every lantern burning low.' },
      { id: 'v2-1', section: 'verse-2', from: 25, to: 32, text: 'Evening falls along the meadow,' },
      { id: 'v2-2', section: 'verse-2', from: 33, to: 40, text: 'every field is turning gold.' },
      { id: 'ch-1', section: 'chorus', from: 41, to: 44, text: 'Carry me home, carry me home,' },
      { id: 'ch-2', section: 'chorus', from: 45, to: 48, text: 'over the hill where the tall grass grows.' },
      { id: 'br-1', section: 'bridge', from: 57, to: 64, text: 'Long is the road,' },
      { id: 'br-2', section: 'bridge', from: 65, to: 72, text: 'but the light remains.' },
      { id: 'fc-1', section: 'final-chorus', from: 73, to: 84, text: 'Carry me home, carry me home.' },
      { id: 'end-1', section: 'ending', from: 85, to: 88, text: 'Home.' },
    ],
    loops: [
      { id: 'bridge-entrance', name: 'Bridge entrance', from: 55, to: 60, note: 'Count the rest, come in clean on 57.' },
      { id: 'final-hold', name: 'Final hold', from: 83, to: 88, note: 'Hold through the fermata, watch the cutoff.' },
    ],
  };
}

/** A small song with a pickup (m. 0) and a 4/4 → 2/4 → 4/4 meter change. */
export function pickupSong(interpolation = 'notated-beats') {
  return {
    id: 'pickup-song',
    title: 'Pickup Song',
    durationSeconds: 20,
    measures: { first: 0, last: 4 },
    audio: 'audio/pickup.mp3',
    score: { format: 'musicxml', src: 'score/pickup.musicxml' },
    sections: [{ id: 'all', label: 'All', from: 0, to: 4 }],
    timing: {
      interpolation,
      anchors: [
        { measure: 0, time: 1.0, source: 'section' },
        { measure: 5, time: 16.0, source: 'terminal' },
      ],
    },
    rests: [{ from: 3, to: 4 }],
    lyrics: [{ id: 'p-1', section: 'all', from: 0, to: 2, text: 'Oh, sing' }],
    loops: [],
  };
}

/** Beats for pickupSong(): a 1-beat pickup, 4/4, 2/4, 4/4, 4/4. Total 15. */
export const PICKUP_BEATS = new Map([[0, 1], [1, 4], [2, 2], [3, 4], [4, 4]]);

export const clone = (v) => JSON.parse(JSON.stringify(v));

/** A minimal stand-in for HTMLAudioElement: enough for the playback module's rules. */
export class FakeAudio extends EventTarget {
  constructor() {
    super();
    this._src = '';
    this.currentTime = 0;
    this.duration = NaN;
    this.paused = true;
    this.ended = false;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this.preservesPitch = false;
    this.playCalls = 0;
    this.srcHistory = [];
  }
  get src() { return this._src; }
  set src(v) {
    // Like the media load algorithm: a new source resets time and both rates.
    this._src = v;
    this.srcHistory.push(v);
    this.currentTime = 0;
    this.ended = false;
    this.paused = true;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
  }
  removeAttribute(name) { if (name === 'src') this._src = ''; }
  load() {}
  play() {
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  /** Simulates metadata arriving for the current source. */
  loaded(duration) {
    this.duration = duration;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  /** Simulates playback reaching time t. */
  advance(t) {
    this.currentTime = t;
    this.dispatchEvent(new Event('timeupdate'));
  }
  /** Simulates the end of the media. */
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeMediaSession {
  constructor() {
    this.metadata = null;
    this.handlers = {};
    this.playbackState = 'none';
    this.positionStates = [];
  }
  setActionHandler(action, handler) { this.handlers[action] = handler; }
  setPositionState(state) { this.positionStates.push(state); }
}

export class FakeMediaMetadata {
  constructor(init) { Object.assign(this, init); }
}

export class MemoryStorage {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

/** A fetch stand-in: routes maps URL → {status, body} or a function that throws. */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (typeof route === 'function') return route();
    if (!route) return response(404, 'Not found');
    return response(route.status ?? 200, typeof route.body === 'string' ? route.body : JSON.stringify(route.body));
  };
  fn.calls = calls;
  return fn;
}

function response(status, text) {
  return { status, ok: status >= 200 && status < 300, text: async () => text };
}
