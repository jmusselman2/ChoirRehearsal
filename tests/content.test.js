import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCatalog, validateSong, loadCatalog, loadSong, durationMismatch, isRelativePath, ContentError,
} from '../app/js/content.js';
import { songOne, pickupSong, fakeFetch } from './fixtures.js';

const catalog = {
  catalogRevision: '2026-10-08.1',
  album: 'Tenor Choir · Fall 2026',
  songs: [{ id: 'song-one', src: 'songs/song-one.json' }],
};

const syncErrors = (mutate) => {
  const song = songOne();
  mutate(song);
  return validateSong(song, { expectedId: 'song-one' }).sync;
};

// ---- Catalog ---------------------------------------------------------------------------------

test('a valid catalog passes', () => {
  assert.deepEqual(validateCatalog(catalog), []);
});

test('catalog validation failures', () => {
  assert.ok(validateCatalog(null).length);
  assert.ok(validateCatalog([]).length);
  assert.ok(validateCatalog({ ...catalog, catalogRevision: '' }).length);
  assert.ok(validateCatalog({ ...catalog, album: 3 }).length);
  assert.ok(validateCatalog({ ...catalog, songs: [] }).length);
  assert.ok(validateCatalog({ ...catalog, songs: [{ id: 'Song One', src: 'songs/a.json' }] }).length);
  assert.ok(validateCatalog({ ...catalog, songs: [{ id: 'a', src: '/songs/a.json' }] }).length, 'root-relative src');
  assert.ok(validateCatalog({ ...catalog, songs: [{ id: 'a', src: 'https://cdn.example/a.json' }] }).length, 'absolute URL');
  assert.ok(validateCatalog({ ...catalog, songs: [{ id: 'a', src: 'a.json' }, { id: 'a', src: 'b.json' }] }).length, 'duplicate id');
});

test('content paths must stay relative', () => {
  assert.equal(isRelativePath('audio/a.mp3'), true);
  assert.equal(isRelativePath('/audio/a.mp3'), false);
  assert.equal(isRelativePath('../secret.mp3'), false);
  assert.equal(isRelativePath('http://x/a.mp3'), false);
  assert.equal(isRelativePath(''), false);
});

// ---- Song ------------------------------------------------------------------------------------

test('the spec Song One passes with no errors or warnings', () => {
  const v = validateSong(songOne(), { expectedId: 'song-one' });
  assert.deepEqual(v, { fatal: [], sync: [], score: [], warnings: [] });
});

test('a song with empty anchors is valid (untimed)', () => {
  assert.deepEqual(syncErrors((s) => { s.timing.anchors = []; }), []);
});

test('fatal failures: the song cannot be offered', () => {
  const fatal = (mutate) => { const s = songOne(); mutate(s); return validateSong(s, { expectedId: 'song-one' }).fatal; };
  assert.ok(fatal((s) => { s.id = 'other'; }).length, 'id differs from the catalog');
  assert.ok(fatal((s) => { delete s.title; }).length);
  assert.ok(fatal((s) => { s.durationSeconds = 0; }).length);
  assert.ok(fatal((s) => { s.audio = '/audio/a.mp3'; }).length);
  assert.ok(fatal((s) => { s.measures = { first: 5, last: 4 }; }).length);
  assert.ok(fatal((s) => { s.measures = { first: -1, last: 4 }; }).length);
  assert.ok(validateSong('nope').fatal.length);
});

test('anchor measures and times must strictly increase', () => {
  assert.ok(syncErrors((s) => { s.timing.anchors[2].measure = 9; }).some((e) => /measures must strictly increase/.test(e)));
  assert.ok(syncErrors((s) => { s.timing.anchors[2].time = 20; }).some((e) => /times must strictly increase/.test(e)));
});

test("anchors must lie within the audio's duration", () => {
  assert.ok(syncErrors((s) => { s.timing.anchors[9].time = 300; }).some((e) => /outside the audio/.test(e)));
  assert.ok(syncErrors((s) => { s.timing.anchors[0].time = -1; }).length);
});

test('required anchors: first measure, every section start, terminal', () => {
  assert.ok(syncErrors((s) => { s.timing.anchors.shift(); }).some((e) => /first anchor/.test(e)));
  assert.ok(syncErrors((s) => { s.timing.anchors.pop(); }).some((e) => /terminal/.test(e)));
  assert.ok(syncErrors((s) => { s.timing.anchors.splice(3, 1); }).some((e) => /"chorus".*no start-time anchor/.test(e)));
  assert.ok(syncErrors((s) => { s.timing.anchors[1].source = 'guess'; }).length);
  assert.ok(syncErrors((s) => { s.timing.interpolation = 'cubic'; }).length);
});

test('sections must not overlap; a gap is only a warning', () => {
  assert.ok(syncErrors((s) => { s.sections[1].to = 25; }).some((e) => /overlaps/.test(e)));
  const s = songOne();
  s.sections[4].from = 50; // m. 49 is now in no section
  s.timing.anchors[4].measure = 50; // the Interlude's start anchor moves with it
  const v = validateSong(s, { expectedId: 'song-one' });
  assert.deepEqual(v.sync, []);
  assert.deepEqual(v.warnings, ['gap between sections at m. 49–49']);
});

test('sections must lie within the measures and have kebab-case ids', () => {
  assert.ok(syncErrors((s) => { s.sections[7].to = 90; }).length);
  assert.ok(syncErrors((s) => { s.sections[0].id = 'Intro'; }).length);
  assert.ok(syncErrors((s) => { s.sections = []; }).length);
});

test('lyric phrases must not overlap and must name a real section', () => {
  assert.ok(syncErrors((s) => { s.lyrics[1].from = 16; }).some((e) => /lyrics: .*overlaps/.test(e)));
  assert.ok(syncErrors((s) => { s.lyrics[0].section = 'verse-9'; }).some((e) => /not a section id/.test(e)));
  assert.ok(syncErrors((s) => { s.lyrics[0].text = 3; }).length);
});

test('rest ranges must not overlap and each entrance comes after its rest', () => {
  assert.ok(syncErrors((s) => { s.rests[1].from = 8; }).some((e) => /rests: .*overlaps/.test(e)));
  assert.ok(syncErrors((s) => { s.rests[0].entrance = 8; }).some((e) => /entrance must come after/.test(e)));
  assert.ok(syncErrors((s) => { delete s.rests[0].entrance; }).some((e) => /needs an entrance/.test(e)));
  // A rest that runs to the end may omit its entrance.
  assert.deepEqual(validateSong(pickupSong(), { expectedId: 'pickup-song' }).sync, []);
});

test('every loop lies within known measures', () => {
  assert.ok(syncErrors((s) => { s.loops[1].to = 89; }).some((e) => /outside m\. 1–88/.test(e)));
  assert.ok(syncErrors((s) => { s.loops[0].from = 61; }).some((e) => /from is after to/.test(e)));
  assert.ok(syncErrors((s) => { s.loops[0].id = s.loops[1].id; }).some((e) => /duplicated/.test(e)));
});

test('score problems disable only the score', () => {
  const s = songOne();
  s.score = { format: 'musicxml', src: '/score/x.musicxml' };
  const v = validateSong(s, { expectedId: 'song-one' });
  assert.equal(v.fatal.length, 0);
  assert.equal(v.sync.length, 0);
  assert.ok(v.score.length);
  const pages = songOne();
  pages.score = { format: 'page-images', pages: [], regions: [] };
  pages.timing.interpolation = 'notated-beats';
  const pv = validateSong(pages, { expectedId: 'song-one' });
  assert.ok(pv.score.length);
  assert.ok(pv.sync.some((e) => /page-image song must use uniform/.test(e)));
});

test("the declared duration must match the decoded audio within 1 s", () => {
  assert.equal(durationMismatch(258, 258.6), null);
  assert.match(durationMismatch(258, 259.5), /differs/);
  assert.equal(durationMismatch(258, NaN), null, 'unknown until metadata loads');
});

// ---- Loading and the sample fallback ----------------------------------------------------------

test('the real catalog is used when it exists', async () => {
  const fetch = fakeFetch({ 'content/catalog.json': { body: catalog } });
  const r = await loadCatalog(fetch);
  assert.equal(r.root, 'content/');
  assert.equal(r.sample, false);
  assert.deepEqual(fetch.calls, ['content/catalog.json']);
});

test('a 404 falls back to content.example/ and marks the sample', async () => {
  const fetch = fakeFetch({ 'content.example/catalog.json': { body: catalog } });
  const r = await loadCatalog(fetch);
  assert.equal(r.root, 'content.example/');
  assert.equal(r.sample, true);
  assert.deepEqual(fetch.calls, ['content/catalog.json', 'content.example/catalog.json']);
});

const noFallback = async (route, kind) => {
  const fetch = fakeFetch({ 'content/catalog.json': route, 'content.example/catalog.json': { body: catalog } });
  await assert.rejects(loadCatalog(fetch), (e) => e instanceof ContentError && e.kind === kind);
  assert.deepEqual(fetch.calls, ['content/catalog.json'], 'the sample catalog is never requested');
};

test('a server error does not fall back', () => noFallback({ status: 500, body: 'oops' }, 'http'));
test('a permission error does not fall back', () => noFallback({ status: 403, body: 'no' }, 'http'));
test('malformed JSON does not fall back', () => noFallback({ body: '{"songs": [' }, 'malformed'));
test('a network failure does not fall back', () => noFallback(() => { throw new TypeError('Failed to fetch'); }, 'network'));
test('a schema failure does not fall back', async () => {
  const fetch = fakeFetch({ 'content/catalog.json': { body: { songs: 'x' } } });
  await assert.rejects(loadCatalog(fetch), (e) => e.kind === 'invalid' && e.errors.length > 0);
  assert.deepEqual(fetch.calls, ['content/catalog.json']);
});

test('a missing sample catalog after a 404 is an error', async () => {
  await assert.rejects(loadCatalog(fakeFetch({})), (e) => e.kind === 'http' && e.status === 404 && /content\.example/.test(e.url));
});

test('songs load relative to the active content root', async () => {
  const fetch = fakeFetch({ 'content.example/songs/song-one.json': { body: songOne() } });
  const r = await loadSong(fetch, 'content.example/', catalog.songs[0]);
  assert.equal(r.status, 'ok');
  assert.equal(r.sync, 'ok');
  assert.equal(r.audioUrl, 'content.example/audio/song-one-tenor.mp3');
  assert.equal(r.scoreUrl, 'content.example/score/song-one-tenor.musicxml');
});

test('invalid sync data keeps the audio playable', async () => {
  const song = songOne();
  song.timing.anchors[3].time = 1; // times no longer increase
  const r = await loadSong(fakeFetch({ 'content/songs/song-one.json': { body: song } }), 'content/', catalog.songs[0]);
  assert.equal(r.status, 'ok');
  assert.equal(r.sync, 'invalid');
  assert.equal(r.audioUrl, 'content/audio/song-one-tenor.mp3');
});

test('an untimed song loads as untimed', async () => {
  const song = songOne();
  song.timing.anchors = [];
  const r = await loadSong(fakeFetch({ 'content/songs/song-one.json': { body: song } }), 'content/', catalog.songs[0]);
  assert.equal(r.sync, 'untimed');
});

test('a broken song file is reported without throwing', async () => {
  const missing = await loadSong(fakeFetch({}), 'content/', catalog.songs[0]);
  assert.equal(missing.status, 'error');
  assert.equal(missing.error.status, 404);
  const malformed = await loadSong(fakeFetch({ 'content/songs/song-one.json': { body: '{' } }), 'content/', catalog.songs[0]);
  assert.equal(malformed.error.kind, 'malformed');
  const wrongId = songOne();
  wrongId.id = 'song-two';
  const invalid = await loadSong(fakeFetch({ 'content/songs/song-one.json': { body: wrongId } }), 'content/', catalog.songs[0]);
  assert.equal(invalid.error.kind, 'invalid');
});

test('the setup page loads the same catalogs one level up', async () => {
  const fetch = fakeFetch({ '../content.example/catalog.json': { body: catalog } });
  const r = await loadCatalog(fetch, '../');
  assert.deepEqual({ root: r.root, sample: r.sample }, { root: '../content.example/', sample: true });
  assert.deepEqual(fetch.calls, ['../content/catalog.json', '../content.example/catalog.json']);
});
