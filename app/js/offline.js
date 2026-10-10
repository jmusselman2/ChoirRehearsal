// Offline saving (spec §19). The page saves every song automatically after the first load; there's
// no download button. Content is saved per catalog revision, and the service worker serves the
// revision named by a pointer that only moves at launch, so a newer revision downloads in the
// background and is used on the next launch, never mid-playback. The previous revision stays
// until the new one is complete.

import { CONTENT_ROOT, SAMPLE_ROOT, CATALOG_FILE, validateCatalog } from './content.js';

export const META_CACHE = 'rehearsal-meta';
export const CONTENT_PREFIX = 'rehearsal-content-';
const POINTER_PATH = '__offline__/active';
const COMPLETE_PATH = '__offline__/complete';
const FRESH = { 'x-rehearsal-fresh': '1' }; // the worker passes these requests to the network

export const STATUS = {
  onlineOnly: () => 'Online only',
  saving: (done, total) => `Saving for offline… ${done} of ${total}`,
  available: (n) => `✓ Available offline · ${n} ${n === 1 ? 'song' : 'songs'}`,
  needsRefresh: () => 'Offline files need refresh',
};

/** The cache name for one content root and revision. */
export function contentCacheName(root, revision) {
  const where = root.replace(/[^a-z0-9.]+/gi, '');
  return `${CONTENT_PREFIX}${where}-${String(revision).replace(/[^a-z0-9._-]+/gi, '_')}`;
}

/** A song's audio and score paths, which are saved alongside its song file. */
export function songFiles(root, song) {
  const files = [];
  if (song && typeof song.audio === 'string') files.push(root + song.audio);
  if (song && song.score && song.score.format === 'musicxml' && typeof song.score.src === 'string') files.push(root + song.score.src);
  return files;
}

/** The Settings footer's version line; mentions a newer installed version until it's in use. */
export function versionText(running, latest) {
  if (running && latest && latest !== running) return `Version ${running} · ${latest} on next launch`;
  const shown = running || latest;
  return shown ? `Version ${shown}` : '';
}

/** Asks a service worker which app version it serves. Null if it doesn't answer (an older one). */
export function askVersion(worker, timeoutMs = 2000) {
  if (!worker || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const done = (value) => {
      clearTimeout(timer);
      channel.port1.close(); // an open port would keep the channel alive
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    channel.port1.onmessage = (event) => done(typeof event.data === 'string' ? event.data : null);
    try {
      worker.postMessage({ type: 'version' }, [channel.port2]);
    } catch {
      done(null);
    }
  });
}

export function createOffline({ onStatus = () => {} } = {}) {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof caches !== 'undefined' && window.isSecureContext;
  const scopeUrl = (path) => new URL(path, document.baseURI).href;
  let status = supported ? '' : STATUS.onlineOnly();
  const setStatus = (s) => { status = s; onStatus(s); };

  async function readPointer() {
    const hit = await (await caches.open(META_CACHE)).match(scopeUrl(POINTER_PATH));
    return hit ? (await hit.json()).cache : null;
  }

  async function writePointer(name) {
    await (await caches.open(META_CACHE)).put(scopeUrl(POINTER_PATH), new Response(JSON.stringify({ cache: name }), { headers: { 'Content-Type': 'application/json' } }));
  }

  async function completeInfo(name) {
    if (!(await caches.has(name))) return null;
    const hit = await (await caches.open(name)).match(scopeUrl(COMPLETE_PATH));
    return hit ? hit.json() : null;
  }

  async function contentCaches() {
    return (await caches.keys()).filter((k) => k.startsWith(CONTENT_PREFIX));
  }

  return {
    get supported() { return supported; },
    get status() { return status; },

    /** At launch, before any content loads: switch to the newest complete revision. */
    async launch() {
      if (!supported) { setStatus(STATUS.onlineOnly()); return; }
      try {
        let best = null;
        for (const name of await contentCaches()) {
          const info = await completeInfo(name);
          if (info && (!best || info.savedAt > best.info.savedAt)) best = { name, info };
        }
        if (best && best.name !== (await readPointer())) await writePointer(best.name);
        if (best) setStatus(STATUS.available(best.info.songs));
      } catch {
        // Cache storage unavailable: the network still works.
      }
    },

    /**
     * Reports the app version for the Settings footer: the one this page came from and, once a
     * newer one has installed, that one too (it's used from the next launch). Call at launch,
     * before register(), so the worker that served this page answers before an update replaces
     * it. The version is defined only in sw.js.
     */
    watchVersion(onVersion) {
      if (!supported) return;
      const sw = navigator.serviceWorker;
      const running = askVersion(sw.controller);
      const report = async () => {
        try {
          const registration = await sw.getRegistration();
          const latest = registration && registration.active ? await askVersion(registration.active) : null;
          onVersion(versionText(await running, latest));
        } catch {
          // No registration yet; the next report fills it in.
        }
      };
      report();
      sw.ready.then(report);
      sw.addEventListener('controllerchange', report);
    },

    register() {
      if (!supported) return Promise.resolve(null);
      return navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
        setStatus(STATUS.onlineOnly());
        return null;
      });
    },

    /** Whether a content file is saved in the revision in use. */
    async isSaved(url) {
      if (!supported) return false;
      try {
        const name = await readPointer();
        if (!name || !(await caches.has(name))) return false;
        return !!(await (await caches.open(name)).match(scopeUrl(url)));
      } catch {
        return false;
      }
    },

    /**
     * Saves the newest revision in the background. Called once per launch after the player is
     * ready; never changes what this session plays.
     */
    async sync() {
      if (!supported) { setStatus(STATUS.onlineOnly()); return; }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const pointer = await readPointer().catch(() => null);
      const current = pointer ? await completeInfo(pointer).catch(() => null) : null;

      // What does the server have now? (Offline, keep what's saved.)
      let fresh;
      try {
        fresh = await fetchFreshCatalog();
      } catch {
        setStatus(current ? STATUS.available(current.songs) : STATUS.onlineOnly());
        return;
      }
      const target = contentCacheName(fresh.root, fresh.catalog.catalogRevision);
      const done = await completeInfo(target).catch(() => null);
      if (done) {
        if (!pointer) await writePointer(target);
        setStatus(STATUS.available(done.songs));
        await prune([pointer, target]);
        return;
      }

      const newer = !!current; // a revision is in use, so this one is newer
      const total = fresh.catalog.songs.length;
      setStatus(newer ? STATUS.needsRefresh() : STATUS.saving(0, total));
      try {
        const cache = await caches.open(target);
        await save(cache, fresh.root + CATALOG_FILE, fresh.response);
        if (fresh.root !== CONTENT_ROOT) {
          // Remember that content/ was missing, so the 404 fallback also works offline.
          await cache.put(scopeUrl(CONTENT_ROOT + CATALOG_FILE), new Response('Not found', { status: 404, statusText: 'Not Found' }));
        }
        for (const [i, entry] of fresh.catalog.songs.entries()) {
          const songUrl = fresh.root + entry.src;
          const res = await fetch(songUrl, { headers: FRESH, cache: 'no-store' });
          if (!res.ok) throw new Error(`${songUrl} returned HTTP ${res.status}`);
          const song = await res.clone().json();
          await save(cache, songUrl, res);
          for (const url of songFiles(fresh.root, song)) {
            if (await cache.match(scopeUrl(url))) continue;
            const file = await fetch(url, { headers: FRESH, cache: 'no-store' });
            // Saved whole: a 200, never a 206 (spec §19).
            if (file.status !== 200) throw new Error(`${url} returned HTTP ${file.status}`);
            await save(cache, url, file);
          }
          if (!newer) setStatus(STATUS.saving(i + 1, total));
        }
        await cache.put(scopeUrl(COMPLETE_PATH), new Response(JSON.stringify({
          revision: fresh.catalog.catalogRevision, root: fresh.root, songs: total, savedAt: Date.now(),
        }), { headers: { 'Content-Type': 'application/json' } }));
        // First save: use it now (this page isn't under the worker yet). A newer revision waits
        // for the next launch.
        if (!pointer) await writePointer(target);
        setStatus(STATUS.available(total));
        await prune([pointer, target]);
      } catch (error) {
        console.warn('Saving for offline stopped:', error);
        const quota = error && error.name === 'QuotaExceededError';
        setStatus(quota || !current ? STATUS.onlineOnly() : STATUS.needsRefresh());
      }
    },
  };

  async function save(cache, url, response) {
    await cache.put(scopeUrl(url), response);
  }

  async function fetchFreshCatalog() {
    let root = CONTENT_ROOT;
    let res = await fetch(root + CATALOG_FILE, { headers: FRESH, cache: 'no-store' });
    if (res.status === 404) {
      root = SAMPLE_ROOT;
      res = await fetch(root + CATALOG_FILE, { headers: FRESH, cache: 'no-store' });
    }
    if (!res.ok) throw new Error(`catalog returned HTTP ${res.status}`);
    const catalog = await res.clone().json();
    if (validateCatalog(catalog).length) throw new Error('catalog failed validation');
    return { root, catalog, response: res };
  }

  /** Deletes content caches other than the ones named (the one in use and the newest). */
  async function prune(keep) {
    for (const name of await contentCaches()) {
      if (!keep.includes(name)) await caches.delete(name);
    }
  }
}
