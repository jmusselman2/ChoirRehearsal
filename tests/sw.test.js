import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { STATUS, contentCacheName, songFiles } from '../app/js/offline.js';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const source = readFileSync(join(APP, 'sw.js'), 'utf8');

/** Loads sw.js in a sandbox and returns its top-level declarations and registered listeners. */
function loadWorker() {
  const listeners = {};
  const sandbox = {
    self: { addEventListener: (type, fn) => { listeners[type] = fn; }, registration: { scope: 'https://example.test/rehearsal/' }, location: new URL('https://example.test/rehearsal/sw.js') },
    caches: {},
    URL,
    Request: class {},
    Response: class { constructor(body, init) { Object.assign(this, { body, ...init }); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;this.__exports = { parseRange, relativePath, SHELL, APP_VERSION };`, sandbox);
  return { ...sandbox.__exports, listeners };
}

test('the worker parses single byte ranges like the PoC did', () => {
  const worker = loadWorker();
  const parseRange = (...args) => { const r = worker.parseRange(...args); return r && { ...r }; }; // out of the sandbox realm
  assert.deepEqual(parseRange('bytes=0-1', 1000), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 }, 'clamped to the file');
  assert.equal(parseRange('bytes=1000-', 1000), null, 'past the end: 416');
  assert.equal(parseRange('bytes=5-2', 1000), null);
  assert.equal(parseRange('bytes=-', 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
});

test('paths are taken relative to the scope, so setup/ and poc/ can be left alone', () => {
  const { relativePath } = loadWorker();
  const scope = 'https://example.test/rehearsal/';
  assert.equal(relativePath('https://example.test/rehearsal/setup/index.html', scope), 'setup/index.html');
  assert.equal(relativePath('https://example.test/rehearsal/poc/sw.js', scope), 'poc/sw.js');
  assert.equal(relativePath('https://example.test/rehearsal/content/audio/a%20b.mp3?x=1', scope), 'content/audio/a b.mp3');
});

test('the worker registers install, activate and fetch, and never claims open pages', () => {
  const { listeners } = loadWorker();
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install']);
  const code = source.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.equal(/clients\s*\.\s*claim\s*\(/.test(code), false);
});

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

test('the precache list covers every module the player loads, and nothing missing', () => {
  const { SHELL } = loadWorker();
  const rel = (f) => relative(APP, f).split('\\').join('/');
  const playerModules = filesUnder(join(APP, 'js')).map(rel).filter((f) => f !== 'js/authoring.js'); // setup page only
  for (const f of playerModules) assert.ok(SHELL.includes(f), `${f} is precached`);
  for (const f of SHELL.filter((p) => p !== './')) assert.ok(statSync(join(APP, f)).isFile(), `${f} exists`);
  assert.ok(SHELL.includes('vendor/opensheetmusicdisplay/opensheetmusicdisplay.min.js'));
  assert.ok(!SHELL.some((p) => p.startsWith('content') || p.startsWith('setup/') || p.startsWith('/')), 'relative, no content or setup');
});

test('APP_VERSION is set so a code change can be deployed by bumping it', () => {
  const { APP_VERSION } = loadWorker();
  assert.match(APP_VERSION, /\S/);
});

test('the Settings status line uses the spec §19 wording', () => {
  assert.equal(STATUS.available(4), '✓ Available offline · 4 songs');
  assert.equal(STATUS.saving(2, 4), 'Saving for offline… 2 of 4');
  assert.equal(STATUS.onlineOnly(), 'Online only');
  assert.equal(STATUS.needsRefresh(), 'Offline files need refresh');
});

test('content caches are named per root and catalog revision', () => {
  assert.equal(contentCacheName('content/', '2026-10-08.1'), 'rehearsal-content-content-2026-10-08.1');
  assert.equal(contentCacheName('content.example/', 'sample-2026-10-09.1'), 'rehearsal-content-content.example-sample-2026-10-09.1');
  assert.notEqual(contentCacheName('content/', 'a'), contentCacheName('content/', 'b'));
});

test('a song saves its audio and MusicXML alongside its song file', () => {
  assert.deepEqual(songFiles('content/', { audio: 'audio/a.mp3', score: { format: 'musicxml', src: 'score/a.musicxml' } }), ['content/audio/a.mp3', 'content/score/a.musicxml']);
  assert.deepEqual(songFiles('content/', { audio: 'audio/a.mp3', score: { format: 'page-images', pages: [] } }), ['content/audio/a.mp3']);
});
