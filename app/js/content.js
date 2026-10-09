// Loading and validating the catalog and song files (spec §12, §15).
//
// The player loads content/catalog.json. Only a 404 falls back to content.example/; malformed
// JSON, permission or server errors, network failures and schema failures are reported, never
// silently replaced by the sample songs.
//
// No DOM code, so the validators and loaders run under node --test with a fake fetch.

export const CONTENT_ROOT = 'content/';
export const SAMPLE_ROOT = 'content.example/';
export const CATALOG_FILE = 'catalog.json';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ANCHOR_SOURCES = ['section', 'measure', 'nudge', 'terminal'];
const INTERPOLATIONS = ['uniform', 'notated-beats'];
const DURATION_TOLERANCE = 1;

export class ContentError extends Error {
  /**
   * @param {'network'|'http'|'malformed'|'invalid'} kind
   * @param {string} message
   * @param {{url?: string, status?: number, errors?: string[]}} [details]
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'ContentError';
    this.kind = kind;
    this.url = details.url || null;
    this.status = details.status ?? null;
    this.errors = details.errors || [];
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isMeasure = (v) => Number.isInteger(v) && v >= 0;
const isId = (v) => typeof v === 'string' && ID_PATTERN.test(v);

/** A content path must stay relative so the app works at / and /rehearsal/. */
export function isRelativePath(v) {
  return isNonEmptyString(v) && !v.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.split('/').includes('..');
}

// ---------------------------------------------------------------------------------------------
// Validation

export function validateCatalog(data) {
  const errors = [];
  if (!isObject(data)) return ['Catalog is not a JSON object'];
  if (!isNonEmptyString(data.catalogRevision)) errors.push('catalogRevision must be a non-empty string');
  if (!isNonEmptyString(data.album)) errors.push('album must be a non-empty string');
  if (!Array.isArray(data.songs) || data.songs.length === 0) {
    errors.push('songs must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  data.songs.forEach((s, i) => {
    if (!isObject(s)) { errors.push(`songs[${i}] is not an object`); return; }
    if (!isId(s.id)) errors.push(`songs[${i}].id must be lowercase kebab-case`);
    else if (seen.has(s.id)) errors.push(`songs[${i}].id "${s.id}" is duplicated`);
    else seen.add(s.id);
    if (!isRelativePath(s.src)) errors.push(`songs[${i}].src must be a relative path`);
  });
  return errors;
}

function checkRange(item, label, first, last, errors) {
  if (!isMeasure(item.from) || !isMeasure(item.to)) {
    errors.push(`${label}: from and to must be measure numbers (integers ≥ 0)`);
    return false;
  }
  if (item.from > item.to) { errors.push(`${label}: from is after to`); return false; }
  if (item.from < first || item.to > last) {
    errors.push(`${label}: m. ${item.from}–${item.to} is outside m. ${first}–${last}`);
    return false;
  }
  return true;
}

function checkIds(list, label, errors) {
  const seen = new Set();
  list.forEach((item, i) => {
    if (!isId(item.id)) errors.push(`${label}[${i}].id must be lowercase kebab-case`);
    else if (seen.has(item.id)) errors.push(`${label}[${i}].id "${item.id}" is duplicated`);
    else seen.add(item.id);
  });
}

function checkNoOverlap(list, label, errors) {
  const sorted = list.filter((x) => isMeasure(x.from) && isMeasure(x.to)).sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) {
      errors.push(`${label}: m. ${sorted[i - 1].from}–${sorted[i - 1].to} overlaps m. ${sorted[i].from}–${sorted[i].to}`);
    }
  }
  return sorted;
}

/**
 * Validates a song file.
 *
 * - fatal: the song can't be offered at all (no audio, title, duration or measure range).
 * - sync: the synced features are disabled ("Timing not set — not synced"), but audio plays.
 * - score: the score can't be shown; audio and lyrics still work.
 * - warnings: reported, nothing disabled (for example a gap between sections).
 */
export function validateSong(data, { expectedId } = {}) {
  const fatal = [];
  const sync = [];
  const score = [];
  const warnings = [];
  const result = { fatal, sync, score, warnings };
  if (!isObject(data)) { fatal.push('Song file is not a JSON object'); return result; }

  if (!isId(data.id)) fatal.push('id must be lowercase kebab-case');
  else if (expectedId && data.id !== expectedId) fatal.push(`id "${data.id}" doesn't match the catalog id "${expectedId}"`);
  if (!isNonEmptyString(data.title)) fatal.push('title must be a non-empty string');
  if (typeof data.durationSeconds !== 'number' || !(data.durationSeconds > 0) || !Number.isFinite(data.durationSeconds)) {
    fatal.push('durationSeconds must be a positive number');
  }
  if (!isRelativePath(data.audio)) fatal.push('audio must be a relative path');
  const m = data.measures;
  if (!isObject(m) || !isMeasure(m.first) || !isMeasure(m.last) || m.first > m.last) {
    fatal.push('measures must have integer first ≤ last, both ≥ 0');
  }
  if (fatal.length) return result;

  const first = m.first;
  const last = m.last;
  const duration = data.durationSeconds;

  // Score
  const sc = data.score;
  if (!isObject(sc)) score.push('score is missing');
  else if (sc.format === 'musicxml') {
    if (!isRelativePath(sc.src)) score.push('score.src must be a relative path');
    if (sc.partId !== undefined && !isNonEmptyString(sc.partId)) score.push('score.partId must be a string');
    if (sc.line !== undefined && !isNonEmptyString(sc.line)) score.push('score.line must be a string');
  } else if (sc.format === 'page-images') {
    score.push('page-image scores are not supported by this build (spec §13: fallback only)');
  } else {
    score.push('score.format must be "musicxml" or "page-images"');
  }

  // Sections
  const sections = Array.isArray(data.sections) ? data.sections : null;
  if (!sections || sections.length === 0) sync.push('sections must be a non-empty array');
  else {
    sections.forEach((s, i) => {
      if (!isObject(s)) { sync.push(`sections[${i}] is not an object`); return; }
      if (!isNonEmptyString(s.label)) sync.push(`sections[${i}].label must be a string`);
      checkRange(s, `sections[${i}] (${s.id})`, first, last, sync);
    });
    checkIds(sections.filter(isObject), 'sections', sync);
    const sorted = checkNoOverlap(sections.filter(isObject), 'sections', sync);
    if (sorted.length) {
      if (sorted[0].from > first) warnings.push(`no section covers m. ${first}–${sorted[0].from - 1}`);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from > sorted[i - 1].to + 1) {
          warnings.push(`gap between sections at m. ${sorted[i - 1].to + 1}–${sorted[i].from - 1}`);
        }
      }
      const end = sorted[sorted.length - 1].to;
      if (end < last) warnings.push(`no section covers m. ${end + 1}–${last}`);
    }
  }
  const sectionIds = new Set((sections || []).filter(isObject).map((s) => s.id));

  // Timing
  const timing = data.timing;
  if (!isObject(timing)) sync.push('timing is missing');
  else {
    if (!INTERPOLATIONS.includes(timing.interpolation)) sync.push('timing.interpolation must be "uniform" or "notated-beats"');
    else if (timing.interpolation === 'notated-beats' && isObject(sc) && sc.format !== 'musicxml') {
      sync.push('a page-image song must use uniform interpolation');
    }
    const anchors = timing.anchors;
    if (!Array.isArray(anchors)) sync.push('timing.anchors must be an array');
    else if (anchors.length > 0) {
      let ok = true;
      anchors.forEach((a, i) => {
        if (!isObject(a) || !Number.isInteger(a.measure) || typeof a.time !== 'number' || !Number.isFinite(a.time)) {
          sync.push(`anchors[${i}] needs an integer measure and a numeric time`);
          ok = false;
          return;
        }
        if (!ANCHOR_SOURCES.includes(a.source)) sync.push(`anchors[${i}].source must be one of ${ANCHOR_SOURCES.join(', ')}`);
        if (a.measure < first || a.measure > last + 1) {
          sync.push(`anchors[${i}] m. ${a.measure} is outside m. ${first}–${last + 1}`);
          ok = false;
        }
        if (a.time < 0 || a.time > duration) {
          sync.push(`anchors[${i}] time ${a.time} is outside the audio (0–${duration} s)`);
          ok = false;
        }
        if (i > 0 && isObject(anchors[i - 1])) {
          const p = anchors[i - 1];
          if (!(a.measure > p.measure)) { sync.push(`anchors[${i}]: measures must strictly increase`); ok = false; }
          if (!(a.time > p.time)) { sync.push(`anchors[${i}]: times must strictly increase`); ok = false; }
        }
      });
      if (ok) {
        if (anchors[0].measure !== first) sync.push(`the first anchor must be the first measure (m. ${first})`);
        const term = anchors[anchors.length - 1];
        if (term.measure !== last + 1) sync.push(`the last anchor must be the terminal anchor at m. ${last + 1}`);
        else if (term.source !== 'terminal') warnings.push('the anchor after the last measure should have source "terminal"');
        const anchored = new Set(anchors.map((a) => a.measure));
        (sections || []).filter(isObject).forEach((s) => {
          if (isMeasure(s.from) && !anchored.has(s.from)) sync.push(`section "${s.id}" (m. ${s.from}) has no start-time anchor`);
        });
      }
    }
  }

  // Rests
  const rests = data.rests === undefined ? [] : data.rests;
  if (!Array.isArray(rests)) sync.push('rests must be an array');
  else {
    rests.forEach((r, i) => {
      if (!isObject(r)) { sync.push(`rests[${i}] is not an object`); return; }
      if (!checkRange(r, `rests[${i}]`, first, last, sync)) return;
      if (r.label !== undefined && typeof r.label !== 'string') sync.push(`rests[${i}].label must be a string`);
      if (r.entrance === undefined || r.entrance === null) {
        if (r.to !== last) sync.push(`rests[${i}] needs an entrance measure (only a rest that runs to the end may omit it)`);
      } else if (!isMeasure(r.entrance) || r.entrance <= r.to) {
        sync.push(`rests[${i}].entrance must come after the rest (m. ${r.to})`);
      } else if (r.entrance > last + 1 || (r.entrance === last + 1 && r.to !== last)) {
        sync.push(`rests[${i}].entrance m. ${r.entrance} is outside the song`);
      }
    });
    checkNoOverlap(rests.filter(isObject), 'rests', sync);
  }

  // Lyric phrases
  const lyrics = data.lyrics === undefined ? [] : data.lyrics;
  if (!Array.isArray(lyrics)) sync.push('lyrics must be an array');
  else {
    lyrics.forEach((p, i) => {
      if (!isObject(p)) { sync.push(`lyrics[${i}] is not an object`); return; }
      if (typeof p.text !== 'string') sync.push(`lyrics[${i}].text must be a string`);
      if (!sectionIds.has(p.section)) sync.push(`lyrics[${i}].section "${p.section}" is not a section id`);
      checkRange(p, `lyrics[${i}] (${p.id})`, first, last, sync);
    });
    checkIds(lyrics.filter(isObject), 'lyrics', sync);
    checkNoOverlap(lyrics.filter(isObject), 'lyrics', sync);
  }

  // Loops
  const loops = data.loops === undefined ? [] : data.loops;
  if (!Array.isArray(loops)) sync.push('loops must be an array');
  else {
    loops.forEach((l, i) => {
      if (!isObject(l)) { sync.push(`loops[${i}] is not an object`); return; }
      if (!isNonEmptyString(l.name)) sync.push(`loops[${i}].name must be a string`);
      if (l.note !== undefined && typeof l.note !== 'string') sync.push(`loops[${i}].note must be a string`);
      checkRange(l, `loops[${i}] (${l.id})`, first, last, sync);
    });
    checkIds(loops.filter(isObject), 'loops', sync);
  }

  return result;
}

/** The declared duration must match the decoded audio within 1 s (spec §12). */
export function durationMismatch(declared, decoded) {
  if (!Number.isFinite(decoded) || decoded <= 0) return null;
  const diff = Math.abs(declared - decoded);
  return diff > DURATION_TOLERANCE
    ? `declared duration ${declared.toFixed(2)} s differs from the audio's ${decoded.toFixed(2)} s`
    : null;
}

// ---------------------------------------------------------------------------------------------
// Loading

async function fetchJson(fetchFn, url) {
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-cache' });
  } catch (e) {
    throw new ContentError('network', `Couldn't reach ${url}`, { url });
  }
  return res;
}

async function parseJson(res, url) {
  let text;
  try {
    text = await res.text();
  } catch {
    throw new ContentError('network', `Couldn't read ${url}`, { url });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ContentError('malformed', `${url} is not valid JSON`, { url });
  }
}

function httpError(res, url) {
  return new ContentError('http', `${url} returned HTTP ${res.status}`, { url, status: res.status });
}

/**
 * Loads content/catalog.json, or content.example/catalog.json when (and only when) the first
 * request returns 404.
 *
 * @returns {Promise<{root: string, sample: boolean, catalog: object}>}
 */
export async function loadCatalog(fetchFn) {
  let root = CONTENT_ROOT;
  let url = root + CATALOG_FILE;
  let res = await fetchJson(fetchFn, url);
  let sample = false;
  if (res.status === 404) {
    root = SAMPLE_ROOT;
    url = root + CATALOG_FILE;
    sample = true;
    res = await fetchJson(fetchFn, url);
  }
  if (!res.ok) throw httpError(res, url);
  const catalog = await parseJson(res, url);
  const errors = validateCatalog(catalog);
  if (errors.length) throw new ContentError('invalid', `${url} failed validation`, { url, errors });
  return { root, sample, catalog };
}

/**
 * Loads and validates one song file. Never throws: a failure is reported in the result so the
 * other songs keep working.
 *
 * @returns {Promise<{id: string, status: 'ok'|'error', song?: object, error?: ContentError,
 *   validation?: object, sync?: 'ok'|'untimed'|'invalid', audioUrl?: string, scoreUrl?: string|null}>}
 */
export async function loadSong(fetchFn, root, entry) {
  const url = root + entry.src;
  try {
    const res = await fetchJson(fetchFn, url);
    if (!res.ok) throw httpError(res, url);
    const song = await parseJson(res, url);
    const validation = validateSong(song, { expectedId: entry.id });
    if (validation.fatal.length) {
      throw new ContentError('invalid', `${url} failed validation`, { url, errors: validation.fatal });
    }
    // Song paths are relative to the content root, like the catalog's own src entries.
    const scoreOk = validation.score.length === 0;
    let sync = 'ok';
    if (validation.sync.length) sync = 'invalid';
    else if (song.timing.anchors.length === 0) sync = 'untimed';
    return {
      id: entry.id,
      status: 'ok',
      song,
      validation,
      sync,
      audioUrl: root + song.audio,
      scoreUrl: scoreOk ? root + song.score.src : null,
    };
  } catch (error) {
    return { id: entry.id, status: 'error', error };
  }
}
