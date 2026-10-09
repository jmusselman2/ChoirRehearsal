// Choir Rehearsal service worker (spec §19). Hand-written, no build step.
//
// - App files are cached per APP_VERSION. Bump it whenever code changes.
// - Content (catalog, song files, scores, audio) is saved by the page into one cache per catalog
//   revision; a pointer in the meta cache names the revision in use. The page moves the pointer
//   only at launch, so a new revision is never swapped in mid-playback.
// - Audio is saved whole (200) and the audio element's Range requests are answered by slicing it
//   into 206 responses, which is what made seeking work offline in the PoC.
// - No clients.claim(): taking over an open page would switch the audio stream's source partway
//   ("data source error" on the Pixel). The worker serves the player from the next launch.
// - Requests under setup/ and poc/ are never answered: the setup page always loads fresh, and the
//   PoC keeps its own worker.

const APP_VERSION = '2026-10-09.7';
const SHELL_CACHE = `rehearsal-shell-${APP_VERSION}`;
const META_CACHE = 'rehearsal-meta';
const CONTENT_PREFIX = 'rehearsal-content-';
const POINTER_PATH = '__offline__/active';
// localhost: how long to wait for the server before using the cached copy. A server that hangs
// (for example behind adb reverse) shouldn't stall a launch.
const NETWORK_TIMEOUT_MS = 2000;

// Every file the player needs to start offline. tests/sw.test.js keeps this in step with app/.
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/main.js',
  'js/content.js',
  'js/format.js',
  'js/loops.js',
  'js/offline.js',
  'js/orientation.js',
  'js/playback.js',
  'js/settings.js',
  'js/timing.js',
  'js/wake-lock.js',
  'js/score/measures.js',
  'js/score/osmd.js',
  'js/score/staff-size.js',
  'js/ui/layers.js',
  'js/views/lyrics.js',
  'js/views/measure.js',
  'js/views/score-card.js',
  'js/views/score-lyrics.js',
  'js/views/score.js',
  'js/views/whole-score.js',
  'vendor/opensheetmusicdisplay/opensheetmusicdisplay.min.js',
];

const scope = () => self.registration.scope;
const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((path) => new Request(new URL(path, scope()), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('rehearsal-shell-') && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(scope())) return;
  const path = relativePath(req.url, scope());
  if (path.startsWith('setup/') || path.startsWith('poc/') || path.startsWith('__offline__/')) return;
  if (req.headers.get('x-rehearsal-fresh')) return; // the page checking the network for a new revision

  if (path.startsWith('content/') || path.startsWith('content.example/')) {
    event.respondWith(contentResponse(req, path));
  } else {
    event.respondWith(isLocal() ? networkFirst(req) : cacheFirst(event, req));
  }
});

/** The request URL relative to the worker's scope, without query or hash. */
function relativePath(href, scopeHref) {
  const u = new URL(href);
  return decodeURIComponent(u.pathname.slice(new URL(scopeHref).pathname.length));
}

// ---- App files ----------------------------------------------------------------------------------

async function shellMatch(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  return req.mode === 'navigate' ? cache.match(new URL('./', scope())) : undefined;
}

// localhost: network first so edits show up without bumping APP_VERSION.
async function networkFirst(req) {
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  network.catch(() => {}); // a late failure after the timeout is expected
  try {
    const first = await Promise.race([network, new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null))]);
    if (first) return first;
    return (await shellMatch(req)) || network;
  } catch (error) {
    const hit = await shellMatch(req);
    if (hit) return hit;
    throw error;
  }
}

// Live site: from the cache, refreshed in the background.
async function cacheFirst(event, req) {
  const hit = await shellMatch(req);
  const refresh = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') await (await caches.open(SHELL_CACHE)).put(req, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

// ---- Content ------------------------------------------------------------------------------------

async function activeContentCache() {
  const meta = await caches.open(META_CACHE);
  const pointer = await meta.match(new URL(POINTER_PATH, scope()));
  if (!pointer) return null;
  const { cache } = await pointer.json();
  return (await caches.has(cache)) ? caches.open(cache) : null;
}

async function contentResponse(req, path) {
  const cache = await activeContentCache();
  const hit = cache ? await cache.match(new URL(path, scope())) : null;
  if (!hit) return fetch(req);
  const range = req.headers.get('Range');
  if (!range) return hit;
  const blob = await hit.blob();
  return rangeResponse(blob, range, hit.headers.get('Content-Type') || 'audio/mpeg');
}

/**
 * Parses a single "bytes=" range against a size. Returns {start, end} (inclusive) or null when
 * it can't be satisfied.
 */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') { // bytes=-N: the last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

function rangeResponse(blob, header, type) {
  const r = parseRange(header, blob.size);
  if (!r) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(blob.slice(r.start, r.end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': type,
      'Content-Range': `bytes ${r.start}-${r.end}/${blob.size}`,
      'Content-Length': String(r.end - r.start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
