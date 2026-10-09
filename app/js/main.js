// Wiring and UI state. Musical position comes only from timing.js (via Timeline.positionAt) and
// playback state only from playback.js; the views below render what they're given.

import { loadCatalog, loadSong, durationMismatch } from './content.js';
import { loadSettings, saveSettings, launchState, stepLyricsSize, normalizeSpeed } from './settings.js';
import { buildTimeline } from './timing.js';
import { createPlayer, SKIP_SECONDS } from './playback.js';
import { createOrientation } from './orientation.js';
import { createWakeLock } from './wake-lock.js';
import { createLayers } from './ui/layers.js';
import { createOffline } from './offline.js';
import { readMeasureBeats } from './score/measures.js';
import { fetchScoreXml } from './score/osmd.js';
import { formatTime, formatSpeed, formatRange, VIEW_LABELS, h } from './format.js';
import { ScoreView } from './views/score.js';
import { LyricsView } from './views/lyrics.js';
import { ScoreLyricsView } from './views/score-lyrics.js';
import { MeasureView } from './views/measure.js';
import { WholeScoreView } from './views/whole-score.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const audio = $('audio');

// ---- Preferences, orientation, wake lock --------------------------------------------------------

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const settings = loadSettings(storage);
const persist = () => saveSettings(storage, settings);

const orientation = createOrientation({ screen: window.screen, document, matchMedia: (q) => window.matchMedia(q) });
// Best-effort and silent: the music shows immediately whatever the browser decides (spec §4).
if (settings.forceLandscape) orientation.apply(true);
const wake = createWakeLock({ navigator, document });
const layers = createLayers();
const offline = createOffline({ onStatus: (text) => { $('offlineStatus').textContent = text; } });

// ---- Views ------------------------------------------------------------------------------------

const views = {
  score: new ScoreView($('viewScore')),
  lyrics: new LyricsView($('viewLyrics')),
  'score-lyrics': new ScoreLyricsView($('viewScoreLyrics')),
  measure: new MeasureView($('viewMeasure')),
};
const whole = new WholeScoreView({
  root: $('whole'),
  scroller: $('wholeScroll'),
  jump: $('wholeJump'),
  playButton: $('wholePlay'),
  playIcon: $('wholePlayIcon'),
  songLabel: $('wholeSong'),
  timeLabel: $('wholeTime'),
});

let songs = []; // per-song context, catalog order
let player = null;
let activeView = null;
let lastFrame = null;
let scrubbing = false;

const currentCtx = () => (player && player.index >= 0 ? songs[player.index] : null);

// ---- Content ----------------------------------------------------------------------------------

function describeError(error) {
  if (!error) return '';
  switch (error.kind) {
    case 'network': return `The server couldn't be reached (${error.url}).`;
    case 'http': return `${error.url} returned HTTP ${error.status}.`;
    case 'malformed': return `${error.url} isn't valid JSON.`;
    case 'invalid': return `${error.url} failed validation:\n${error.errors.slice(0, 6).join('\n')}`;
    default: return error.message || String(error);
  }
}

function sectionsInRests(song) {
  const rests = song.rests || [];
  const resting = (m) => rests.some((r) => m >= r.from && m <= r.to);
  const out = new Set();
  for (const s of song.sections) {
    let all = true;
    for (let m = s.from; m <= s.to && all; m++) all = resting(m);
    if (all) out.add(s.id);
  }
  return out;
}

async function prepareSong(result, index) {
  if (result.status !== 'ok') {
    console.error(`Song "${result.id}" couldn't load:`, describeError(result.error));
    return { index, id: result.id, title: result.id, status: 'error', error: result.error, loops: [] };
  }
  const { song, validation } = result;
  if (validation.sync.length) console.warn(`${song.id}: synced views disabled —`, validation.sync);
  if (validation.score.length) console.warn(`${song.id}: score unavailable —`, validation.score);
  if (validation.warnings.length) console.warn(`${song.id}:`, validation.warnings);

  let beats = null;
  if (result.sync === 'ok' && song.timing.interpolation === 'notated-beats' && result.scoreUrl) {
    try {
      beats = readMeasureBeats(await fetchScoreXml(result.scoreUrl), song.score.partId);
    } catch (error) {
      console.warn(`${song.id}: MusicXML unavailable for notated-beat timing; using uniform spacing`, error);
    }
  }
  const timeline = result.sync === 'ok' ? buildTimeline(song, { beats }) : null;
  if (timeline && timeline.interpolationFallback) console.warn(`${song.id}: notated-beat timing fell back to uniform spacing`);
  const phrases = (song.lyrics || []).slice().sort((a, b) => a.from - b.from);
  return {
    index,
    id: song.id,
    title: song.title,
    status: 'ok',
    song,
    timeline,
    synced: !!timeline,
    audioUrl: result.audioUrl,
    scoreUrl: result.scoreUrl,
    partId: song.score && song.score.partId,
    line: (song.score && song.score.line) || 'Tenor',
    measureAvailable: !!(song.score && song.score.format === 'musicxml' && result.scoreUrl),
    phrases,
    sectionsWithLyrics: new Set(phrases.map((p) => p.section)),
    restSections: sectionsInRests(song),
    loops: song.loops || [],
  };
}

let contentRoot = null;
let catalogEntries = [];

async function boot() {
  showStatus('Loading…');
  // Switch to a newer saved revision only now, before anything plays (spec §19).
  await offline.launch();
  let content;
  try {
    content = await loadCatalog((url, init) => fetch(url, init));
  } catch (error) {
    console.error("The catalog couldn't load:", error);
    showStatus("Couldn't load the songs", describeError(error), boot);
    return;
  }
  contentRoot = content.root;
  catalogEntries = content.catalog.songs;
  const results = await Promise.all(catalogEntries.map((entry) => loadSong((u, i) => fetch(u, i), content.root, entry)));
  songs = await Promise.all(results.map(prepareSong));
  $('sampleStatus').hidden = !content.sample;

  if (!player) {
    player = createPlayer({
      audio,
      tracks: songs.map((c) => ({ id: c.id, title: c.title, src: c.status === 'ok' ? c.audioUrl : null, duration: c.song ? c.song.durationSeconds : 0 })),
      mediaSession: 'mediaSession' in navigator ? navigator.mediaSession : null,
      MediaMetadata: typeof window.MediaMetadata === 'function' ? window.MediaMetadata : null,
      album: content.catalog.album,
      artwork: [{ src: new URL('icons/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
      rate: settings.speed,
      repeat: settings.repeat,
      onChange,
    });
  }
  buildSongList();
  app.dataset.ready = 'true';
  $('titleBtn').disabled = false;
  // Every launch: the last song, at 0:00, paused, with no loop running (spec §2, §11).
  const launch = launchState(settings, songs.map((c) => c.id));
  player.load(launch.songIndex);
  // Save every song for offline use in the background; no download button (spec §19).
  offline.register().then(() => offline.sync());
}

async function retrySong(index) {
  const result = await loadSong((u, i) => fetch(u, i), contentRoot, catalogEntries[index]);
  songs[index] = await prepareSong(result, index);
  const track = player.tracks[index];
  track.title = songs[index].title;
  track.src = songs[index].status === 'ok' ? songs[index].audioUrl : null;
  track.duration = songs[index].song ? songs[index].song.durationSeconds : 0;
  buildSongList();
  player.load(index);
}

// ---- Status (loading, missing content, errors) ------------------------------------------------

function showStatus(text, detail = '', retry = null) {
  $('status').hidden = false;
  $('statusText').textContent = text;
  $('statusDetail').textContent = detail;
  $('statusDetail').hidden = !detail;
  const btn = $('statusRetry');
  btn.hidden = !retry;
  btn.onclick = retry;
  for (const key of Object.keys(views)) $(viewElementId(key)).hidden = true;
  if (activeView) activeView.hide();
  activeView = null;
}

function hideStatus() {
  $('status').hidden = true;
}

const viewElementId = (key) => ({ score: 'viewScore', lyrics: 'viewLyrics', 'score-lyrics': 'viewScoreLyrics', measure: 'viewMeasure' }[key]);

const audioAlertText = h('span', { text: "This song's audio couldn't load. " });
const audioAlertRetry = h('button', { type: 'button', class: 'pill-btn', text: 'Retry', onclick: () => player && player.retry() });
const audioAlert = h('div', { class: 'notice', role: 'alert', hidden: true }, audioAlertText, audioAlertRetry);
$('content').prepend(audioAlert);

// ---- Views and the view mode ------------------------------------------------------------------

function effectiveViewMode(ctx) {
  if (settings.viewMode === 'measure' && ctx && ctx.status === 'ok' && !ctx.measureAvailable) return 'score-lyrics';
  return settings.viewMode;
}

function applyView() {
  const ctx = currentCtx();
  if (!ctx) return;
  if (ctx.status !== 'ok') {
    showStatus("This song couldn't load", describeError(ctx.error), () => retrySong(ctx.index));
    updateChrome();
    return;
  }
  hideStatus();
  const mode = effectiveViewMode(ctx);
  const note = $('viewNote');
  note.hidden = mode === settings.viewMode;
  note.textContent = note.hidden ? '' : 'Measure needs MusicXML — showing Score + Lyrics.';
  app.dataset.view = mode;
  for (const [key, view] of Object.entries(views)) {
    const el = $(viewElementId(key));
    const on = key === mode;
    el.hidden = !on;
    if (!on && view === activeView) view.hide();
  }
  if (activeView !== views[mode]) {
    activeView = views[mode];
    activeView.show();
  }
  updateChrome();
  requestRender();
}

function setViewMode(mode) {
  settings.viewMode = mode;
  persist();
  applyView();
  syncSettingsUi();
}

// ---- Render loop: rAF while visible, timeupdate while hidden (spec §11) -------------------------

let rafId = 0;

function frameLoop() {
  rafId = 0;
  if (player) player.tick();
  render();
  if (player && !audio.paused && document.visibilityState === 'visible') rafId = requestAnimationFrame(frameLoop);
}

function requestRender() {
  if (document.visibilityState !== 'visible') { render(); return; }
  if (!rafId) rafId = requestAnimationFrame(frameLoop);
}

function render() {
  const ctx = currentCtx();
  if (!player || !ctx) return;
  const st = player.state;
  const t = st.time;
  const position = ctx.timeline ? ctx.timeline.positionAt(t, player.loopState) : { timed: false, time: t };
  const frame = { ctx, position, time: t, duration: st.duration, playing: st.playing };
  lastFrame = frame;
  renderPlayerBar(frame);
  renderLoopUi(frame);
  if (activeView && ctx.status === 'ok') activeView.update(frame);
  if (layers.current === 'whole') whole.update(frame);
}

function renderPlayerBar({ time, duration, playing, position }) {
  const d = duration || 0;
  const input = $('scrubInput');
  input.max = String(d);
  if (!scrubbing) input.value = String(Math.min(time, d));
  input.setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(d)}`);
  $('scrubFill').style.width = d > 0 ? `${Math.min(100, (time / d) * 100)}%` : '0';
  $('timeNow').textContent = formatTime(time);
  $('timeLeft').textContent = `−${formatTime(Math.max(0, d - time))}`;
  $('playIcon').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const loopBand = $('scrubLoop');
  if (position.timed && position.loop && d > 0) {
    loopBand.hidden = false;
    loopBand.style.left = `${(position.loop.start / d) * 100}%`;
    loopBand.style.width = `${((position.loop.end - position.loop.start) / d) * 100}%`;
  } else {
    loopBand.hidden = true;
  }
}

function buildTicks() {
  const ctx = currentCtx();
  const box = $('scrubTicks');
  box.textContent = '';
  const d = player ? player.state.duration : 0;
  if (!ctx || !ctx.timeline || !(d > 0)) return;
  for (const s of ctx.timeline.sectionStarts()) {
    if (s.time <= 0.05) continue;
    const tick = h('span', { class: 'scrub-tick', title: s.label });
    tick.style.left = `${(s.time / d) * 100}%`;
    box.append(tick);
  }
}

let loopUiKey = '';
function renderLoopUi({ position }) {
  const loop = position.timed ? position.loop : null;
  const key = `${settings.loopsEnabled}|${loop ? `${loop.id}:${loop.status}` : ''}`;
  if (key === loopUiKey) return;
  loopUiKey = key;
  const chip = $('loopChip');
  chip.hidden = !settings.loopsEnabled;
  chip.classList.toggle('on', !!loop);
  $('loopChipText').textContent = loop ? loop.name : 'Loops';
  chip.setAttribute('aria-label', loop ? `Practice loops: ${loop.name} active` : 'Practice loops');
  const banner = $('loopBanner');
  banner.hidden = !loop;
  if (loop) {
    $('loopBannerText').replaceChildren('Loop · ', h('b', { text: loop.name }), ` · ${formatRange(loop.from, loop.to)}`);
  }
  if (layers.current === 'loops') buildLoopRows($('loopSheetList'));
  if (layers.current === 'settings') buildLoopRows($('settingsLoopList'));
}

// ---- Header and chips -------------------------------------------------------------------------

const narrow = window.matchMedia('(max-width: 380px)');

function updateChrome() {
  const ctx = currentCtx();
  $('titleText').textContent = ctx ? ctx.title : 'Choir Rehearsal';
  document.title = ctx ? `${ctx.title} · Choir Rehearsal` : 'Choir Rehearsal';
  const mode = effectiveViewMode(ctx);
  const label = mode === 'score-lyrics' && narrow.matches ? 'Score+Lyr' : VIEW_LABELS[mode];
  $('viewChipText').textContent = label;
  $('viewChip').setAttribute('aria-label', `View: ${VIEW_LABELS[mode]}`);
  $('speedChipText').textContent = formatSpeed(settings.speed);
  $('speedChip').setAttribute('aria-label', `Playback speed ${formatSpeed(settings.speed)}`);
  const lyricsMode = mode === 'lyrics' && ctx && ctx.status === 'ok';
  $('lyricsSmaller').hidden = !lyricsMode;
  $('lyricsLarger').hidden = !lyricsMode;
  document.documentElement.style.setProperty('--lyrics-size', `${settings.lyricsSize}px`);
  const playable = !!(ctx && ctx.status === 'ok' && player && !player.error && !ctx.offlineMissing);
  $('playBtn').disabled = !playable;
  $('wholePlay').disabled = !playable;
  $('scrubInput').disabled = !playable;
  const offlineMissing = !!(ctx && ctx.status === 'ok' && ctx.offlineMissing);
  audioAlertText.textContent = offlineMissing ? "This song isn't available offline yet." : "This song's audio couldn't load. ";
  audioAlertRetry.hidden = offlineMissing;
  audioAlert.hidden = !(ctx && ctx.status === 'ok' && player && (player.error === 'audio' || offlineMissing));
  loopUiKey = '';
}

// ---- Playback events ----------------------------------------------------------------------------

function onChange(reason) {
  switch (reason) {
    case 'track': onTrack(); break;
    case 'metadata': onMetadata(); break;
    case 'playing':
    case 'paused':
      wake.update(settings.keepScreenOn, !audio.paused);
      requestRender();
      break;
    case 'error': checkOfflineAvailability(currentCtx()); updateChrome(); requestRender(); break;
    case 'loop':
      loopUiKey = '';
      requestRender();
      break;
    default: requestRender();
  }
}

function onTrack() {
  const ctx = currentCtx();
  checkOfflineAvailability(ctx);
  settings.lastSongId = ctx.id;
  persist();
  for (const view of Object.values(views)) view.setSong(ctx);
  whole.setSong(ctx);
  buildTicks();
  markCurrentSong();
  applyView();
  updateChrome();
  if (layers.current === 'loops') buildLoopRows($('loopSheetList'));
  if (layers.current === 'settings') buildLoopRows($('settingsLoopList'));
}

// Offline with this song's audio not saved: say so and disable Play for this song only (spec §19).
async function checkOfflineAvailability(ctx) {
  if (!ctx || ctx.status !== 'ok') return;
  const missing = !navigator.onLine && !(await offline.isSaved(ctx.audioUrl));
  if (missing !== !!ctx.offlineMissing) {
    ctx.offlineMissing = missing;
    if (missing) player.pause();
    updateChrome();
  }
}
window.addEventListener('online', () => { const ctx = currentCtx(); if (ctx) { ctx.offlineMissing = false; updateChrome(); } });
window.addEventListener('offline', () => checkOfflineAvailability(currentCtx()));

function onMetadata() {
  const ctx = currentCtx();
  if (ctx && ctx.status === 'ok' && ctx.timeline) {
    const mismatch = durationMismatch(ctx.song.durationSeconds, audio.duration);
    if (mismatch) {
      // Fails validation (spec §12): audio plays, synced views show "not synced".
      console.warn(`${ctx.id}: ${mismatch}; synced views disabled`);
      ctx.timeline = null;
      ctx.synced = false;
      player.stopLoop();
      for (const view of Object.values(views)) view.setSong(ctx);
      whole.setSong(ctx);
    }
  }
  buildTicks();
  updateChrome();
  requestRender();
}

// ---- Commands ---------------------------------------------------------------------------------

function setSpeed(value) {
  const v = normalizeSpeed(Number(value));
  if (v === null) return;
  settings.speed = player ? player.setRate(v) : v;
  persist();
  syncSettingsUi();
  updateChrome();
}

function setLyricsSize(direction) {
  settings.lyricsSize = stepLyricsSize(settings.lyricsSize, direction);
  persist();
  syncSettingsUi();
  updateChrome();
  views.lyrics.resize();
  requestRender();
}

function startLoop(loop) {
  const ctx = currentCtx();
  if (!ctx || !ctx.timeline) return;
  player.startLoop(loop, ctx.timeline.loopRange(loop));
  settings.selectedLoops[ctx.id] = loop.id;
  persist();
}

$('playBtn').addEventListener('click', () => player && player.toggle());
$('wholePlay').addEventListener('click', () => player && player.toggle());
$('back5').addEventListener('click', () => player && player.skip(-SKIP_SECONDS));
$('fwd5').addEventListener('click', () => player && player.skip(SKIP_SECONDS));
$('prevBtn').addEventListener('click', () => player && player.prev());
$('nextBtn').addEventListener('click', () => player && player.next());
$('loopBannerStop').addEventListener('click', () => player && player.stopLoop());

const scrub = $('scrubInput');
scrub.addEventListener('pointerdown', () => { scrubbing = true; });
scrub.addEventListener('input', () => { scrubbing = true; player && player.seek(Number(scrub.value)); });
scrub.addEventListener('change', () => { scrubbing = false; requestRender(); });
window.addEventListener('pointerup', () => { if (scrubbing) { scrubbing = false; requestRender(); } });

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target !== document.body || layers.current && layers.current !== 'whole') return;
  if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (player) player.toggle(); }
  if (e.key === 'Escape' && layers.current === 'whole') layers.close('whole');
});
$('whole').addEventListener('keydown', (e) => { if (e.key === 'Escape') layers.close('whole'); });

// ---- Sheets -----------------------------------------------------------------------------------

function registerDialog(name, dialog, onOpen) {
  layers.register(name, {
    show() {
      if (onOpen) onOpen();
      if (!dialog.open) dialog.showModal();
    },
    hide() { if (dialog.open) dialog.close(); },
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); layers.close(name); });
  dialog.addEventListener('close', () => {
    if (dialog.dataset.restacking) { delete dialog.dataset.restacking; return; }
    layers.closedExternally(name);
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) layers.close(name); }); // the scrim
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => layers.close(name)));
}

registerDialog('songs', $('songSheet'), markCurrentSong);
registerDialog('view', $('viewSheet'), buildViewMenu);
registerDialog('speed', $('speedSheet'), syncSettingsUi);
registerDialog('loops', $('loopSheet'), () => {
  const ctx = currentCtx();
  $('loopSheetTitle').textContent = ctx ? `Practice loops — ${ctx.title}` : 'Practice loops';
  buildLoopRows($('loopSheetList'));
});
registerDialog('settings', $('settingsSheet'), () => { syncSettingsUi(); buildLoopRows($('settingsLoopList')); });
layers.register('whole', {
  show() {
    if (lastFrame) whole.update(lastFrame);
    whole.show();
  },
  hide() { whole.hide(); },
});

$('titleBtn').addEventListener('click', () => layers.open('songs'));
$('settingsBtn').addEventListener('click', () => layers.open('settings'));
$('speedChip').addEventListener('click', () => layers.open('speed'));
$('viewChip').addEventListener('click', () => layers.open('view'));
$('loopChip').addEventListener('click', () => layers.open('loops'));
$('wholeClose').addEventListener('click', () => layers.close('whole'));

function buildSongList() {
  const list = $('songList');
  list.textContent = '';
  songs.forEach((ctx, i) => {
    const row = h('button', { type: 'button', class: 'song-row', dataset: { index: String(i) } },
      h('span', { class: 'song-name', text: ctx.title }),
      h('span', { class: 'song-dur', text: ctx.song ? formatTime(ctx.song.durationSeconds) : 'Unavailable' }));
    row.addEventListener('click', () => {
      layers.close('songs');
      player.select(i); // a song change starts the new song from 0:00
    });
    list.append(h('li', {}, row));
  });
  markCurrentSong();
}

function markCurrentSong() {
  const index = player ? player.index : -1;
  $('songList').querySelectorAll('.song-row').forEach((row) => {
    if (Number(row.dataset.index) === index) row.setAttribute('aria-current', 'true');
    else row.removeAttribute('aria-current');
  });
}

function buildViewMenu() {
  const ctx = currentCtx();
  const menu = $('viewMenu');
  menu.textContent = '';
  const mode = effectiveViewMode(ctx);
  for (const key of ['score', 'lyrics', 'score-lyrics', 'measure']) {
    const disabled = key === 'measure' && ctx && ctx.status === 'ok' && !ctx.measureAvailable;
    const item = h('button', {
      type: 'button', class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(key === mode), disabled,
    }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: VIEW_LABELS[key] }),
    disabled ? h('span', { class: 'why', text: 'Needs MusicXML' }) : null);
    item.addEventListener('click', () => {
      layers.close('view');
      setViewMode(key);
    });
    menu.append(item);
  }
  menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
  const wholeItem = h('button', { type: 'button', class: 'menu-item', role: 'menuitem', disabled: !ctx || ctx.status !== 'ok' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text: 'Whole score →' }));
  wholeItem.addEventListener('click', () => layers.open('whole'));
  menu.append(wholeItem);
}

function buildLoopRows(container) {
  const ctx = currentCtx();
  container.textContent = '';
  if (container.id === 'settingsLoopList') container.hidden = !settings.loopsEnabled;
  if (!ctx || ctx.status !== 'ok' || ctx.loops.length === 0) {
    container.append(h('p', { class: 'empty', text: 'No loops for this song yet.' }));
    return;
  }
  const state = player.loopState;
  for (const loop of ctx.loops) {
    const active = state.loop && state.loop.id === loop.id;
    const range = ctx.timeline ? ctx.timeline.loopRange(loop) : null;
    const detail = `${formatRange(loop.from, loop.to)} · ${range ? formatTime(range.end - range.start) : 'Timing not set'}`;
    const start = h('button', { type: 'button', class: 'loop-start', disabled: !range },
      h('span', { class: 'loop-name', text: loop.name }),
      h('span', { class: 'loop-range', text: detail }),
      loop.note ? h('span', { class: 'loop-note', text: loop.note }) : null);
    start.addEventListener('click', () => {
      const from = layers.current;
      layers.close(from);
      startLoop(loop);
    });
    const row = h('div', { class: `loop-row${active ? ' current' : ''}` }, start);
    if (active) {
      const stop = h('button', { type: 'button', class: 'loop-stop', text: 'Stop', 'aria-label': `Stop ${loop.name}` });
      stop.addEventListener('click', () => player.stopLoop());
      row.append(stop);
    }
    container.append(row);
  }
}

// ---- Settings controls ------------------------------------------------------------------------

function setPressed(groupId, value) {
  $(groupId).querySelectorAll('button[data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}

function syncSettingsUi() {
  for (const id of ['speedSetting', 'speedQuick']) $(id).value = String(settings.speed);
  $('speedSettingValue').textContent = formatSpeed(settings.speed);
  $('speedQuickValue').textContent = formatSpeed(settings.speed);
  setPressed('repeatSeg', settings.repeat);
  $('repeatHint').hidden = settings.repeat !== 'off';
  const ctx = currentCtx();
  setPressed('viewModeSeg', settings.viewMode);
  const measureBtn = $('viewModeSeg').querySelector('[data-value="measure"]');
  measureBtn.disabled = !!(ctx && ctx.status === 'ok' && !ctx.measureAvailable);
  measureBtn.title = measureBtn.disabled ? 'Needs MusicXML' : '';
  $('lyricsSizeValue').textContent = String(settings.lyricsSize);
  $('landscapeSwitch').setAttribute('aria-checked', String(settings.forceLandscape));
  $('wakeSwitch').setAttribute('aria-checked', String(settings.keepScreenOn));
  $('loopsSwitch').setAttribute('aria-checked', String(settings.loopsEnabled));
  $('settingsLoopList').hidden = !settings.loopsEnabled;
}

for (const id of ['speedSetting', 'speedQuick']) $(id).addEventListener('input', (e) => setSpeed(e.target.value));

$('repeatSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  settings.repeat = b.dataset.value;
  if (player) player.setRepeat(settings.repeat);
  persist();
  syncSettingsUi();
});

$('viewModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (b && !b.disabled) setViewMode(b.dataset.value);
});

$('settingsSmaller').addEventListener('click', () => setLyricsSize(-1));
$('settingsLarger').addEventListener('click', () => setLyricsSize(1));
$('lyricsSmaller').addEventListener('click', () => setLyricsSize(-1));
$('lyricsLarger').addEventListener('click', () => setLyricsSize(1));

$('landscapeSwitch').addEventListener('click', () => {
  settings.forceLandscape = !settings.forceLandscape;
  persist();
  syncSettingsUi();
  // On: a user-triggered request may enter fullscreen first. Off: unlock immediately.
  orientation.apply(settings.forceLandscape, { userInitiated: true });
});

$('wakeSwitch').addEventListener('click', () => {
  settings.keepScreenOn = !settings.keepScreenOn;
  persist();
  syncSettingsUi();
  wake.update(settings.keepScreenOn, !audio.paused);
});

$('loopsSwitch').addEventListener('click', () => {
  settings.loopsEnabled = !settings.loopsEnabled;
  // Off stops any running loop and hides the chip, but remembers the selected loop (spec §8).
  if (!settings.loopsEnabled && player) player.stopLoop();
  persist();
  syncSettingsUi();
  buildLoopRows($('settingsLoopList'));
  loopUiKey = '';
  requestRender();
});

// ---- Page lifecycle ---------------------------------------------------------------------------

let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (activeView) activeView.resize();
    whole.resize();
    updateChrome();
    requestRender();
  }, 150);
}
window.addEventListener('resize', onResize);
document.addEventListener('score-ready', () => requestRender());
// Entering fullscreen puts the page above an already-open sheet in the top layer; re-open the
// sheet on top without treating it as closed (which would pop its history entry).
document.addEventListener('fullscreenchange', () => {
  for (const dialog of document.querySelectorAll('dialog.sheet[open]')) {
    dialog.dataset.restacking = 'true';
    dialog.close();
    dialog.showModal();
  }
});
narrow.addEventListener('change', updateChrome);

document.addEventListener('visibilitychange', () => {
  // Back in the foreground: re-read everything from the audio element.
  if (document.visibilityState === 'visible') {
    wake.update(settings.keepScreenOn, !audio.paused);
    requestRender();
  }
});

syncSettingsUi();
updateChrome();
boot();
