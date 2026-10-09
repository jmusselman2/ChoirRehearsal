// Persisted preferences (spec §11). Only the settings named there are stored; playback position
// and the running loop never are. A missing or corrupt stored state falls back to defaults.

export const STORAGE_KEY = 'choir-rehearsal.settings.v2';
// v1 stored Score + Lyrics as the default view on every phone. Its other settings carry over,
// but its view doesn't, so every phone opens on Measure, the new default, once.
export const LEGACY_STORAGE_KEY = 'choir-rehearsal.settings.v1';

export const VIEW_MODES = ['score', 'lyrics', 'score-lyrics', 'measure'];
export const REPEAT_MODES = ['off', 'one', 'all'];
export const LYRICS_SIZES = [18, 20, 22, 26, 30];
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 1.5;
export const SPEED_STEP = 0.1;

export const DEFAULTS = Object.freeze({
  lastSongId: null,
  viewMode: 'measure',
  speed: 1,
  lyricsSize: 22,
  repeat: 'off',
  forceLandscape: true,
  keepScreenOn: true,
  loopsEnabled: false,
  selectedLoops: Object.freeze({}),
});

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Rounds to the 0.1× slider steps and clamps to 0.5–1.5×. Returns null for non-numbers. */
export function normalizeSpeed(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = Math.min(Math.max(value, SPEED_MIN), SPEED_MAX);
  return Math.round(clamped / SPEED_STEP) / 10;
}

/** Keeps only the allowlisted settings, replacing each invalid value with its default. */
export function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULTS, selectedLoops: {} };
  if (typeof src.lastSongId === 'string' && ID_PATTERN.test(src.lastSongId)) out.lastSongId = src.lastSongId;
  if (VIEW_MODES.includes(src.viewMode)) out.viewMode = src.viewMode;
  const speed = normalizeSpeed(src.speed);
  if (speed !== null) out.speed = speed;
  if (LYRICS_SIZES.includes(src.lyricsSize)) out.lyricsSize = src.lyricsSize;
  if (REPEAT_MODES.includes(src.repeat)) out.repeat = src.repeat;
  if (typeof src.forceLandscape === 'boolean') out.forceLandscape = src.forceLandscape;
  if (typeof src.keepScreenOn === 'boolean') out.keepScreenOn = src.keepScreenOn;
  if (typeof src.loopsEnabled === 'boolean') out.loopsEnabled = src.loopsEnabled;
  if (src.selectedLoops && typeof src.selectedLoops === 'object' && !Array.isArray(src.selectedLoops)) {
    for (const [songId, loopId] of Object.entries(src.selectedLoops)) {
      if (ID_PATTERN.test(songId) && typeof loopId === 'string' && ID_PATTERN.test(loopId)) {
        out.selectedLoops[songId] = loopId;
      }
    }
  }
  return out;
}

/** Reads settings from a Storage-like object; any failure yields defaults. */
export function loadSettings(storage) {
  try {
    const text = storage ? storage.getItem(STORAGE_KEY) : null;
    if (text) return sanitizeSettings(JSON.parse(text));
    const legacy = storage ? storage.getItem(LEGACY_STORAGE_KEY) : null;
    if (!legacy) return sanitizeSettings(null);
    const { viewMode, ...rest } = JSON.parse(legacy) || {};
    return sanitizeSettings(rest);
  } catch {
    return sanitizeSettings(null);
  }
}

/** Writes only the allowlisted settings. Returns false if storage is unavailable or full. */
export function saveSettings(storage, settings) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/**
 * The state every launch starts from: the last song (or the first if it's gone), at 0:00,
 * paused, with no loop running (spec §2, §11).
 */
export function launchState(settings, songIds) {
  const found = songIds.indexOf(settings.lastSongId);
  return {
    songIndex: found === -1 ? 0 : found,
    time: 0,
    playing: false,
    loop: null,
  };
}

export function stepLyricsSize(size, direction) {
  const i = LYRICS_SIZES.indexOf(size);
  const from = i === -1 ? LYRICS_SIZES.indexOf(DEFAULTS.lyricsSize) : i;
  const to = Math.min(Math.max(from + direction, 0), LYRICS_SIZES.length - 1);
  return LYRICS_SIZES[to];
}
