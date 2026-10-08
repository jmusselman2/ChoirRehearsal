// Offline checkpoint for the rehearsal PoC. Throwaway code: see README.md.
// Serves the page from cache when the network is gone, and answers the audio
// element's Range requests from cached MP3s so seeking works offline.
// The page itself saves the MP3s into AUDIO_CACHE (see index.html).

var SHELL_CACHE = 'poc-shell-v2';
var AUDIO_CACHE = 'poc-audio-v1';
var SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'mock/artwork.png', 'mock/icon-192.png',
  'mock/score-placeholder.svg'];

// Send a line to every open page's event log.
function notify(msg, cls) {
  self.clients.matchAll().then(function (list) {
    list.forEach(function (c) { c.postMessage({ type: 'sw-log', msg: msg, cls: cls || '' }); });
  });
}

function fileName(url) { return url.split('/').pop().split('?')[0]; }

self.addEventListener('install', function (event) {
  // Cache each shell file on its own, so one missing file (e.g. no config.js) doesn't fail the rest.
  event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
    return Promise.all(SHELL.map(function (path) {
      return cache.add(path).catch(function (e) { notify('shell file not cached: ' + path + ' (' + e.message + ')', 'err'); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE && k !== AUDIO_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (/\.mp3$/i.test(new URL(req.url).pathname)) {
    event.respondWith(audioResponse(req));
  } else {
    event.respondWith(networkFirst(req));
  }
});

// Page, config and images: network first so edits show up, cache when offline.
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') {
      var copy = res.clone();
      // Only refresh an existing cache, so Remove offline copy isn't undone by a late request.
      caches.has(SHELL_CACHE).then(function (has) {
        if (has) return caches.open(SHELL_CACHE).then(function (cache) { return cache.put(req, copy); });
      });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./');
      return Response.error();
    });
  });
}

// MP3s: from the cache if saved (sliced to the requested Range), otherwise from the network.
function audioResponse(req) {
  // caches.match with cacheName doesn't create the cache, so Remove offline copy stays removed.
  return caches.match(req.url, { cacheName: AUDIO_CACHE }).then(function (cached) {
    var range = req.headers.get('Range');
    if (!cached) {
      notify('audio from network: ' + fileName(req.url) + (range ? ' ' + range : ''));
      return fetch(req);
    }
    if (!range) {
      notify('audio from cache: ' + fileName(req.url) + ' (whole file)');
      return cached;
    }
    return cached.blob().then(function (blob) {
      return sliceResponse(blob, range, cached.headers.get('Content-Type') || 'audio/mpeg', req.url);
    });
  });
}

function sliceResponse(blob, range, type, url) {
  var size = blob.size;
  var m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  var start, end;
  if (m && m[1] === '' && m[2] !== '') {          // bytes=-N: the last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else if (m && m[1] !== '') {                  // bytes=N- or bytes=N-M
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start == null || start >= size || start > end) {
    notify('bad range ' + range + ' for ' + fileName(url) + ' (' + size + ' bytes)', 'err');
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  notify('audio from cache: ' + fileName(url) + ' ' + range + ' → 206 ' + start + '-' + end + '/' + size);
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': type,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}
