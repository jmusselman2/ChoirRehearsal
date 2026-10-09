// The light setup page (spec §16): mark section starts and per-measure refinements against the
// recording, confirm proposed rests and lyric phrases, add loops, validate and export the song
// file. All timing and validation logic is shared with the player (../js/); this file is UI.

import { loadCatalog, loadSong, validateSong, durationMismatch } from '../js/content.js';
import { buildTimeline } from '../js/timing.js';
import { readMeasureBeats, readNotes } from '../js/score/measures.js';
import {
  createMarkSession, proposeRests, proposePhrases, buildSongFile, formatSongJson, loopId, round2,
} from '../js/authoring.js';
import { h, formatRange } from '../js/format.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const DRAFT_PREFIX = 'choir-rehearsal.setup.v1:';
const NUDGE = 0.1;

let root = '';
let entries = [];
let cur = null; // the song being edited
let rafId = 0;

const storage = (() => { try { return window.localStorage; } catch { return null; } })();

/** m:ss.t — the setup page shows tenths (spec §12); anchors are stored to 0.01 s. */
function fmt(t) {
  if (!Number.isFinite(t)) return '—';
  const tenths = Math.round(Math.max(0, t) * 10);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
}

// ---- Loading ------------------------------------------------------------------------------------

async function boot() {
  try {
    const content = await loadCatalog((u, i) => fetch(u, i), '../');
    root = content.root;
    entries = content.catalog.songs;
    $('sampleBadge').hidden = !content.sample;
  } catch (error) {
    showLoadError(`Couldn't load the catalog: ${error.message}${error.errors && error.errors.length ? `\n${error.errors.join('\n')}` : ''}`);
    return;
  }
  const select = $('songSelect');
  select.replaceChildren(...entries.map((e, i) => h('option', { value: String(i), text: e.id })));
  select.disabled = false;
  select.addEventListener('change', () => openSong(Number(select.value)));
  // Titles for the picker; a song that fails to load keeps its id and shows its error when picked.
  Promise.all(entries.map((e) => loadSong((u, i) => fetch(u, i), root, e))).then((results) => {
    results.forEach((r, i) => { if (r.status === 'ok') select.options[i].textContent = r.song.title; });
  });
  await openSong(0);
}

function showLoadError(text) {
  $('loadError').textContent = text;
  $('loadError').hidden = false;
}

async function openSong(index, { useStaleDraft = false } = {}) {
  audio.pause();
  const result = await loadSong((u, i) => fetch(u, i), root, entries[index]);
  if (result.status !== 'ok') {
    $('main').hidden = true;
    showLoadError(`${entries[index].id}: ${result.error.message}${result.error.errors && result.error.errors.length ? `\n${result.error.errors.join('\n')}` : ''}`);
    return;
  }
  $('loadError').hidden = true;
  const song = result.song;
  let xml = null;
  if (result.scoreUrl) {
    try {
      const res = await fetch(result.scoreUrl, { cache: 'no-cache' });
      if (res.ok) xml = await res.text();
    } catch {
      xml = null;
    }
  }
  const partId = song.score && song.score.partId;
  cur = {
    index,
    song,
    xml,
    beats: xml ? readMeasureBeats(xml, partId) : null,
    notes: xml ? readNotes(xml, partId) : [],
    rests: structuredClone(song.rests || []),
    lyrics: structuredClone(song.lyrics || []),
    loops: structuredClone(song.loops || []),
    durationSeconds: song.durationSeconds,
    session: null,
    file: null,
    timeline: null,
    validation: null,
    base: fingerprint(song),
  };
  // A draft only applies to the file it was made from. If the file has changed since (a new
  // export was installed), the draft is set aside rather than silently covering the new file.
  const draft = loadDraft();
  const current = draft && draft.base === cur.base;
  if (draft && (current || useStaleDraft)) {
    Object.assign(cur, { rests: draft.rests, lyrics: draft.lyrics, loops: draft.loops, durationSeconds: draft.durationSeconds });
    cur.session = createMarkSession({ ...song, timing: { ...song.timing, anchors: draft.anchors } });
  } else {
    cur.session = createMarkSession(song);
  }
  showDraftNote(!draft ? null : current || useStaleDraft ? 'restored' : 'stale');
  // Titles show once a song is open.
  $('songSelect').options[index].textContent = song.title;
  $('songSelect').value = String(index);
  $('formatBadge').textContent = song.score ? (song.score.format === 'musicxml' ? 'MusicXML' : 'Page images') : 'No score';
  $('formatBadge').hidden = false;
  $('rangeFrom').value = String(song.measures.first);
  $('rangeTo').value = String(song.measures.last);
  $('rangeFrom').min = $('rangeTo').min = String(song.measures.first);
  $('rangeFrom').max = $('rangeTo').max = String(song.measures.last);
  $('loopFrom').min = $('loopTo').min = String(song.measures.first);
  $('loopFrom').max = $('loopTo').max = String(song.measures.last);
  $('proposeRests').disabled = $('proposeLyrics').disabled = !xml;
  $('restProposal').hidden = $('lyricProposal').hidden = true;
  setMode('sections');
  audio.src = result.audioUrl;
  audio.playbackRate = audio.defaultPlaybackRate = Number($('speed').value);
  if ('preservesPitch' in audio) audio.preservesPitch = true;
  $('main').hidden = false;
  changed({ tables: true, save: false }); // opening a song isn't an edit
}

// ---- Drafts: marking takes a while, so unsaved work survives a reload --------------------------

const draftKey = () => `${DRAFT_PREFIX}${root}${cur.song.id}`;

/** A short hash of the song file as loaded, so a draft knows which file it belongs to. */
function fingerprint(song) {
  const text = JSON.stringify(song);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

function showDraftNote(kind) {
  const note = $('draftNote');
  note.hidden = !kind;
  if (!kind) return;
  const discard = h('button', { type: 'button', class: 'su-link', text: 'Discard', onclick: discardDraft });
  if (kind === 'restored') {
    note.replaceChildren('Unsaved draft restored · ', discard);
  } else {
    const restore = h('button', { type: 'button', class: 'su-link', text: 'Restore it', onclick: () => openSong(cur.index, { useStaleDraft: true }) });
    note.replaceChildren('The song file changed since your last draft, so the draft was set aside · ', restore, ' · ', discard);
  }
}

function discardDraft() {
  try { storage.removeItem(draftKey()); } catch { /* nothing saved */ }
  openSong(cur.index);
}

function loadDraft() {
  try {
    const raw = storage && storage.getItem(draftKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft() {
  try {
    storage.setItem(draftKey(), JSON.stringify({
      anchors: cur.session.anchors(cur.durationSeconds).filter((a) => a.source !== 'terminal'),
      rests: cur.rests,
      lyrics: cur.lyrics,
      loops: cur.loops,
      durationSeconds: cur.durationSeconds,
      base: cur.base,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage full or unavailable: the export still works.
  }
}


// ---- Derived state: the song file, validation and the preview timeline ------------------------

function changed({ tables = false, save = true } = {}) {
  const anchors = cur.session.anchors(cur.durationSeconds);
  cur.file = buildSongFile(cur.song, {
    anchors, rests: cur.rests, lyrics: cur.lyrics, loops: cur.loops, durationSeconds: cur.durationSeconds,
  });
  cur.validation = validateSong(cur.file, { expectedId: cur.song.id });
  cur.timeline = null;
  if (!cur.validation.fatal.length && !cur.validation.sync.length && anchors.length) {
    try {
      cur.timeline = buildTimeline(cur.file, { beats: cur.beats });
    } catch {
      cur.timeline = null;
    }
  }
  if (save) saveDraft();
  if (tables) {
    renderRests();
    renderLyrics();
  }
  renderMarks();
  renderLoops();
  renderValidation();
  renderMarkBox();
  frame();
}

// ---- Marking ----------------------------------------------------------------------------------

function sectionLabelAt(measure) {
  const s = cur.song.sections.find((x) => x.from === measure);
  return s ? s.label : '';
}

function setMode(mode) {
  $('modeSeg').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === mode)));
  $('rangeFields').hidden = mode !== 'measures';
  if (mode === 'sections') cur.session.setSectionsMode();
  else cur.session.setMeasuresMode(Number($('rangeFrom').value), Number($('rangeTo').value));
  if (cur.file) changed({ save: false });
}

function mark() {
  if (!cur || cur.session.next === null) return;
  cur.session.mark(audio.currentTime);
  changed();
}

function renderMarkBox() {
  const s = cur.session;
  const next = s.next;
  const btn = $('markBtn');
  btn.disabled = next === null;
  $('markTarget').textContent = next === null
    ? (s.mode === 'sections' ? 'All section starts are marked' : 'This pass is done')
    : `Next: ${formatRange(next, next)}${sectionLabelAt(next) ? ` · ${sectionLabelAt(next)}` : ''}`;
  $('skipBtn').disabled = next === null;
  $('undoBtn').disabled = !s.canUndo;
  const order = s.outOfOrder();
  $('markHint').textContent = order.length
    ? `Marks out of order at ${order.map((m) => `m. ${m}`).join(', ')}: each mark must be later than the one before.`
    : s.mode === 'sections'
      ? 'Play, and tap Mark (or Space) as each section begins.'
      : 'Each tap marks the next measure. Skip long rests; mark the re-entry.';
}

function renderMarks() {
  const s = cur.session;
  const marks = new Map(s.marks().map((m) => [m.measure, m]));
  const rows = new Set([...marks.keys(), ...s.targets]);
  const order = new Set(s.outOfOrder());
  const tbody = $('marksTable').tBodies[0];
  tbody.replaceChildren(...[...rows].sort((a, b) => a - b).map((measure) => {
    const m = marks.get(measure);
    const label = sectionLabelAt(measure);
    const tr = h('tr', { class: [measure === s.next ? 'next' : '', order.has(measure) ? 'warn' : ''].join(' ').trim() || undefined },
      h('td', {}, `m. ${measure}`, label ? h('div', { class: 'label', text: label }) : null),
      h('td', { class: 't', text: m ? fmt(m.time) : '—' }),
      h('td', { class: 'label', text: m ? m.source : 'not marked' }),
      h('td', { class: 'acts' },
        h('button', { type: 'button', class: 'su-btn small', disabled: !m, 'aria-label': `m. ${measure} 0.1 s earlier`, onclick: () => { s.nudge(measure, -NUDGE); changed(); } }, '−0.1'),
        h('button', { type: 'button', class: 'su-btn small', disabled: !m, 'aria-label': `m. ${measure} 0.1 s later`, onclick: () => { s.nudge(measure, NUDGE); changed(); } }, '+0.1')),
      h('td', { class: 'acts' },
        h('button', { type: 'button', class: 'su-btn small', title: 'Set this mark to the current playback time', onclick: () => { s.remark(measure, audio.currentTime); changed(); } }, m ? 'Re-mark' : 'Mark now'),
        h('button', { type: 'button', class: 'su-btn small', disabled: !m, onclick: () => { audio.currentTime = Math.max(0, m.time - 2); } }, 'Hear'),
        s.targets.includes(measure) ? h('button', { type: 'button', class: 'su-btn small', onclick: () => { s.aim(measure); changed({ save: false }); } }, 'Aim') : null,
        m ? h('button', { type: 'button', class: 'su-btn small', 'aria-label': `Remove the mark at m. ${measure}`, onclick: () => { s.remove(measure); changed(); } }, '×') : null));
    return tr;
  }));
  const mismatch = durationMismatch(cur.durationSeconds, audio.duration);
  const note = $('durationNote');
  note.hidden = !mismatch;
  if (mismatch) {
    note.replaceChildren(`The song file's ${mismatch.replace(/^declared /, '')}. `,
      h('button', { type: 'button', class: 'su-btn small', onclick: () => { cur.durationSeconds = round2(audio.duration); changed(); } }, `Use ${audio.duration.toFixed(2)} s`));
  }
}

// ---- Rests and lyrics: proposals and editing ----------------------------------------------------

const numberOrNull = (v) => (v === '' || v === null ? null : Number(v));

function cell(value, onInput, attrs = {}) {
  const input = h('input', { value: value ?? '', ...attrs });
  input.addEventListener('input', () => { onInput(input.value); changed({ tables: false }); });
  return h('td', {}, input);
}

function renderRests() {
  const tbody = $('restsTable').tBodies[0];
  tbody.replaceChildren(...cur.rests.map((r, i) => h('tr', {},
    cell(r.from, (v) => { r.from = Number(v); }, { type: 'number', class: 'su-num', 'aria-label': 'Rest from measure' }),
    cell(r.to, (v) => { r.to = Number(v); }, { type: 'number', class: 'su-num', 'aria-label': 'Rest to measure' }),
    cell(r.entrance, (v) => { const n = numberOrNull(v); if (n === null) delete r.entrance; else r.entrance = n; }, { type: 'number', class: 'su-num', placeholder: 'end', 'aria-label': 'Entrance measure' }),
    cell(r.label, (v) => { if (v) r.label = v; else delete r.label; }, { class: 'wide', 'aria-label': 'Label' }),
    h('td', { class: 'acts' }, h('button', { type: 'button', class: 'su-btn small', 'aria-label': 'Remove rest', onclick: () => { cur.rests.splice(i, 1); changed({ tables: true }); } }, '×')))));
  if (!cur.rests.length) tbody.append(h('tr', {}, h('td', { colspan: '5', class: 'label', text: 'No rest ranges.' })));
}

function renderLyrics() {
  const sections = cur.song.sections;
  const tbody = $('lyricsTable').tBodies[0];
  tbody.replaceChildren(...cur.lyrics.map((p, i) => {
    const select = h('select', { 'aria-label': 'Section' }, ...sections.map((s) => h('option', { value: s.id, text: s.label })));
    select.value = p.section;
    select.addEventListener('change', () => { p.section = select.value; changed({ tables: false }); });
    return h('tr', {},
      h('td', {}, select),
      cell(p.from, (v) => { p.from = Number(v); }, { type: 'number', class: 'su-num', 'aria-label': 'From measure' }),
      cell(p.to, (v) => { p.to = Number(v); }, { type: 'number', class: 'su-num', 'aria-label': 'To measure' }),
      cell(p.text, (v) => { p.text = v; }, { class: 'wide', 'aria-label': 'Phrase text' }),
      h('td', { class: 'acts' }, h('button', { type: 'button', class: 'su-btn small', 'aria-label': 'Remove phrase', onclick: () => { cur.lyrics.splice(i, 1); changed({ tables: true }); } }, '×')));
  }));
  if (!cur.lyrics.length) tbody.append(h('tr', {}, h('td', { colspan: '5', class: 'label', text: 'No lyric phrases.' })));
}

function showProposal(boxId, title, items, describe, onUse) {
  const box = $(boxId);
  box.hidden = false;
  box.replaceChildren(
    h('div', { text: `${title}: ${items.length}` }),
    h('ul', {}, ...items.map((x) => h('li', { text: describe(x) }))),
    h('div', { class: 'su-panel-actions' },
      h('button', { type: 'button', class: 'su-btn', onclick: () => { onUse(); box.hidden = true; } }, 'Use these (replaces the list below)'),
      h('button', { type: 'button', class: 'su-btn', onclick: () => { box.hidden = true; } }, 'Dismiss')));
}

$('proposeRests').addEventListener('click', () => {
  const proposed = proposeRests(cur.notes, cur.song.measures.first, cur.song.measures.last);
  showProposal('restProposal', 'Measures with no sung notes', proposed,
    (r) => `${formatRange(r.from, r.to)} → ${r.entrance !== undefined ? `enters m. ${r.entrance}` : 'to the end'}`,
    () => { cur.rests = proposed; changed({ tables: true }); });
});

$('proposeLyrics').addEventListener('click', () => {
  const proposed = proposePhrases(cur.notes, cur.song.sections);
  showProposal('lyricProposal', 'Phrases from the MusicXML syllables', proposed,
    (p) => `${formatRange(p.from, p.to)} · ${p.text}`,
    () => { cur.lyrics = proposed.filter((p) => p.section); changed({ tables: true }); });
});

$('addRest').addEventListener('click', () => {
  cur.rests.push({ from: cur.song.measures.first, to: cur.song.measures.first, entrance: cur.song.measures.first + 1 });
  changed({ tables: true });
});

$('addLyric').addEventListener('click', () => {
  const section = cur.song.sections[0];
  const used = new Set(cur.lyrics.map((p) => p.id));
  let n = 1;
  while (used.has(`${section.id}-${n}`)) n++;
  cur.lyrics.push({ id: `${section.id}-${n}`, section: section.id, from: section.from, to: section.from, text: '' });
  changed({ tables: true });
});

// ---- Loops --------------------------------------------------------------------------------------

function renderLoops() {
  const tbody = $('loopsTable').tBodies[0];
  tbody.replaceChildren(...cur.loops.map((l, i) => {
    const range = cur.timeline ? cur.timeline.loopRange(l) : null;
    return h('tr', {},
      h('td', { text: l.name }),
      h('td', { class: 't', text: formatRange(l.from, l.to) }),
      h('td', { class: 't', text: range ? `${fmt(range.start)} – ${fmt(range.end)} (${(range.end - range.start).toFixed(1)} s)` : 'Timing not set' }),
      h('td', { class: 'label', text: l.note || '' }),
      h('td', { class: 'acts' },
        h('button', { type: 'button', class: 'su-btn small', disabled: !range, onclick: () => { audio.currentTime = range.start; audio.play(); } }, 'Play'),
        h('button', { type: 'button', class: 'su-btn small', 'aria-label': `Remove ${l.name}`, onclick: () => { cur.loops.splice(i, 1); changed(); } }, '×')));
  }));
  if (!cur.loops.length) tbody.append(h('tr', {}, h('td', { colspan: '5', class: 'label', text: 'No loops for this song yet.' })));
}

$('loopForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('loopName').value.trim();
  const from = Number($('loopFrom').value);
  const to = Number($('loopTo').value);
  if (!name || !Number.isInteger(from) || !Number.isInteger(to)) return;
  const loop = { id: loopId(name, cur.loops.map((l) => l.id)), name, from: Math.min(from, to), to: Math.max(from, to) };
  const note = $('loopNote').value.trim();
  if (note) loop.note = note;
  cur.loops.push(loop);
  $('loopForm').reset();
  changed();
});

// ---- Validation and export ----------------------------------------------------------------------

function renderValidation() {
  const v = cur.validation;
  const list = $('problems');
  const items = [
    ...v.fatal.map((t) => ['fatal', t]),
    ...v.sync.map((t) => ['sync', t]),
    ...v.score.map((t) => ['warn', `Score: ${t}`]),
    ...v.warnings.map((t) => ['warn', t]),
  ];
  const mismatch = durationMismatch(cur.durationSeconds, audio.duration);
  if (mismatch) items.push(['sync', `${mismatch} (the player turns sync off)`]);
  const ok = !v.fatal.length && !v.sync.length && !mismatch;
  const untimed = cur.file.timing.anchors.length === 0;
  if (ok) items.unshift(['ok', untimed ? 'Valid, but not timed yet: the player shows it unsynced.' : 'Valid: loads synced in the player.']);
  list.replaceChildren(...items.map(([cls, text]) => h('li', { class: cls, text })));
  const badge = $('validity');
  badge.textContent = ok ? (untimed ? 'Valid · not timed' : '✓ Valid') : `${v.fatal.length + v.sync.length + (mismatch ? 1 : 0)} problem(s)`;
  badge.className = `su-validity ${ok ? 'ok' : 'bad'}`;
  $('jsonOut').value = formatSongJson(cur.file);
  $('copyJson').disabled = $('downloadJson').disabled = !!v.fatal.length;
}

$('copyJson').addEventListener('click', async () => {
  const text = formatSongJson(cur.file);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $('jsonOut').select();
    document.execCommand('copy');
  }
  $('copyJson').textContent = 'Copied';
  setTimeout(() => { $('copyJson').textContent = 'Copy JSON'; }, 1500);
});

$('downloadJson').addEventListener('click', () => {
  const blob = new Blob([formatSongJson(cur.file)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${cur.song.id}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

// ---- Preview: section, measure, phrase and rest from the timing module, plus the strip --------

function frame() {
  if (!cur) return;
  const t = audio.currentTime;
  const d = Number.isFinite(audio.duration) ? audio.duration : cur.durationSeconds;
  $('clock').textContent = `${fmt(t)} / ${fmt(d)}`;
  const seek = $('seek');
  seek.max = String(d);
  if (document.activeElement !== seek) seek.value = String(t);
  $('playIcon').setAttribute('href', audio.paused ? '#su-play' : '#su-pause');
  $('playBtn').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');

  const tl = cur.timeline;
  if (tl) {
    const p = tl.positionAt(t);
    $('pvSection').textContent = p.section ? p.section.label : '(no section)';
    $('pvMeasure').textContent = `m. ${p.measure}`;
    $('pvKind').textContent = tl.isExplicit(p.measure) ? 'marked boundary' : 'inferred boundary';
    $('pvLyric').textContent = p.phrase ? p.phrase.text : '';
    $('pvRest').textContent = p.rest ? (p.rest.countdown !== null ? `Tenor enters in ${p.rest.countdown}` : 'Tenor rests') : '';
  } else {
    $('pvSection').textContent = 'Not synced';
    $('pvMeasure').textContent = '';
    $('pvKind').textContent = cur.session.marks().length ? 'fix the problems in Validate to preview' : 'mark the sections to preview';
    $('pvLyric').textContent = '';
    $('pvRest').textContent = '';
  }
  drawStrip(t, d);
}

function drawStrip(t, d) {
  const canvas = $('strip');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const x = (time) => (d > 0 ? (time / d) * w : 0);
  const tl = cur.timeline;

  // Loops
  if (tl) {
    g.fillStyle = color('--loop-band');
    for (const l of cur.loops) {
      const r = tl.loopRange(l);
      g.fillRect(x(r.start), 18, Math.max(1, x(r.end) - x(r.start)), hgt - 22);
    }
  }
  // Measure boundaries: solid where marked, hollow where inferred
  const sectionStarts = new Set(cur.song.sections.map((s) => s.from));
  if (tl) {
    for (let m = tl.first; m <= tl.last + 1; m++) {
      const xx = Math.round(x(tl.measureStart(m))) + 0.5;
      if (tl.isExplicit(m)) {
        g.strokeStyle = color('--text');
        g.setLineDash([]);
        g.beginPath(); g.moveTo(xx, 26); g.lineTo(xx, hgt - 4); g.stroke();
      } else {
        g.strokeStyle = color('--text-3');
        g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(xx, 46); g.lineTo(xx, hgt - 4); g.stroke();
      }
    }
    g.setLineDash([]);
    g.font = '11px system-ui, sans-serif';
    for (const s of cur.song.sections) {
      const xx = x(tl.measureStart(s.from));
      g.fillStyle = color('--text-2');
      g.fillRect(xx, 4, 2, 18);
      g.fillStyle = color('--text-2');
      g.fillText(s.label, xx + 4, 15);
    }
  } else {
    for (const mk of cur.session.marks()) {
      const xx = Math.round(x(mk.time)) + 0.5;
      g.strokeStyle = sectionStarts.has(mk.measure) ? color('--text-2') : color('--text');
      g.beginPath(); g.moveTo(xx, 18); g.lineTo(xx, hgt - 4); g.stroke();
    }
  }
  // Playhead
  g.fillStyle = color('--accent');
  g.fillRect(Math.round(x(t)) - 1, 0, 2, hgt);
}

function loop() {
  rafId = 0;
  frame();
  if (!audio.paused) rafId = requestAnimationFrame(loop);
}
const kick = () => { if (!rafId) rafId = requestAnimationFrame(loop); };

// ---- Controls -----------------------------------------------------------------------------------

$('playBtn').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
$('back5').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
$('fwd5').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 5); });
$('seek').addEventListener('input', (e) => { audio.currentTime = Number(e.target.value); frame(); });
$('speed').addEventListener('input', (e) => {
  audio.playbackRate = audio.defaultPlaybackRate = Number(e.target.value);
  $('speedOut').textContent = `${Number(e.target.value).toFixed(1)}×`;
});
$('strip').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const d = Number.isFinite(audio.duration) ? audio.duration : cur.durationSeconds;
  audio.currentTime = ((e.clientX - r.left) / r.width) * d;
  frame();
});
for (const ev of ['play', 'pause', 'seeked', 'timeupdate']) audio.addEventListener(ev, kick);
audio.addEventListener('loadedmetadata', () => {
  audio.playbackRate = audio.defaultPlaybackRate = Number($('speed').value);
  if (cur) changed({ save: false });
});
window.addEventListener('resize', () => { if (cur) frame(); });

$('modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (b) setMode(b.dataset.value);
});
$('rangeStart').addEventListener('click', () => setMode('measures'));
$('markBtn').addEventListener('click', mark);
$('skipBtn').addEventListener('click', () => { cur.session.skip(); changed({ save: false }); });
$('undoBtn').addEventListener('click', () => { cur.session.undo(); changed(); });
$('clearBtn').addEventListener('click', () => {
  if (!window.confirm('Clear every mark for this song? Undo can restore them one at a time.')) return;
  cur.session.clear();
  changed();
});

document.addEventListener('keydown', (e) => {
  if (!cur) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
  if (e.key === ' ' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault(); // Space always marks, even with a button focused (spec §16)
    mark();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    cur.session.undo();
    changed();
  }
});

// Tabs
const tabs = [...document.querySelectorAll('.su-tabs [role="tab"]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  });
}

boot();
