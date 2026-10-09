// The paper card that follows the tenor line (spec §5, Score and Score + Lyrics): the current
// system sits at the top with the next ones below, and the card glides up one system at a time.
// Every musical value comes from the timing Position; this file only maps measures onto the
// rendered systems.

import { h, prefersReducedMotion } from '../format.js';
import { renderScore, fetchScoreXml, forgetScoreXml } from '../score/osmd.js';

export class ScoreCard {
  constructor() {
    this.sectionLabel = h('span', { class: 'sec' });
    this.lineLabel = h('span', { class: 'line' });
    this.sheet = h('div', { class: 'score-sheet' });
    this.tint = h('div', { class: 'overlay tint' });
    this.window = h('div', { class: 'score-window' }, this.sheet);
    this.loading = h('p', { class: 'score-loading', text: 'Loading score…' });
    this.retryBtn = h('button', { type: 'button', class: 'pill-btn', text: 'Retry', onclick: () => this.retry() });
    this.failed = h('div', { class: 'score-failed', hidden: true }, h('p', { text: 'Score unavailable' }), this.retryBtn);
    this.el = h('div', { class: 'paper score-card current' },
      h('div', { class: 'card-head' }, this.sectionLabel, this.lineLabel), this.window, this.loading, this.failed);
    this.ctx = null;
    this.layout = null;
    this.renderedWidth = 0;
    this.renderToken = 0;
    this.bands = [];
    this.bandKey = '';
    this.shownSection = undefined;
    this.shownSystem = -1;
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.layout = null;
    this.renderedWidth = 0;
    this.renderToken++;
    this.sheet.textContent = '';
    this.bands = [];
    this.bandKey = '';
    this.shownSection = undefined;
    this.shownSystem = -1;
    this.lineLabel.textContent = ctx && ctx.status === 'ok' ? ctx.line : '';
    this.sectionLabel.textContent = '';
    this.setState(ctx && ctx.scoreUrl ? 'loading' : 'failed');
  }

  setState(state) {
    this.state = state;
    this.loading.hidden = state !== 'loading';
    this.failed.hidden = state !== 'failed';
    // OSMD measures its container, so the window stays in layout (just invisible) while loading.
    this.window.hidden = state === 'failed';
    this.window.style.visibility = state === 'ready' ? '' : 'hidden';
    // Rendering finishes asynchronously; ask the app for a frame even while paused.
    if (state === 'ready') this.el.dispatchEvent(new Event('score-ready', { bubbles: true }));
  }

  /** Renders when visible and the width changed. Score failures never touch playback. */
  async ensureRendered() {
    const ctx = this.ctx;
    if (!ctx || !ctx.scoreUrl || this.state === 'failed') return;
    const width = this.el.clientWidth;
    if (width < 50 || Math.abs(width - this.renderedWidth) < 2) return;
    const token = ++this.renderToken;
    this.renderedWidth = width;
    if (!this.layout) this.setState('loading');
    try {
      const xml = await fetchScoreXml(ctx.scoreUrl);
      if (token !== this.renderToken) return;
      const holder = h('div');
      this.sheet.replaceChildren(this.tint, holder);
      this.layout = await renderScore(holder, xml, { layout: 'page', width: width - 8, partId: ctx.partId });
      if (token !== this.renderToken) return;
      this.bands.forEach((b) => b.remove());
      this.bands = [];
      this.bandKey = '';
      this.shownSection = undefined;
      this.shownSystem = -1;
      this.setState('ready');
    } catch (error) {
      if (token !== this.renderToken) return;
      console.error('Score render failed:', error);
      this.layout = null;
      this.renderedWidth = 0;
      this.setState('failed');
    }
  }

  retry() {
    if (!this.ctx || !this.ctx.scoreUrl) return;
    forgetScoreXml(this.ctx.scoreUrl);
    this.renderedWidth = 0;
    this.setState('loading');
    this.ensureRendered();
  }

  update(position) {
    if (this.state !== 'ready' || !this.layout) return;
    const L = this.layout;
    if (!position.timed) {
      // Not synced: the whole tenor line, scrolled by hand.
      this.window.classList.add('free');
      this.sheet.classList.remove('glide');
      this.sheet.style.transform = '';
      this.shownSystem = -1;
      this.tint.hidden = true;
      this.sectionLabel.textContent = '';
      return;
    }
    this.window.classList.remove('free');
    const section = position.section;
    const current = L.systemOf(position.measure) || (section && L.systemOf(section.from));
    if (!current) return;

    const index = L.systems.indexOf(current);
    const room = this.window.clientHeight;
    if (index !== this.shownSystem || room !== this.shownRoom) {
      // Start where the previous system's lyrics end, so marks above the staff stay in view,
      // and stop before blank paper at the end of the song.
      const prev = L.systems[index - 1];
      const top = Math.max(0, Math.min(prev ? Math.min(current.top, prev.bottom) : 0, L.height - room));
      // Glide to the next or previous system; a jump further than that (a seek) moves at once.
      const glide = this.shownSystem !== -1 && Math.abs(index - this.shownSystem) === 1 && !prefersReducedMotion();
      this.sheet.classList.toggle('glide', glide);
      this.sheet.style.transform = `translateY(${-top}px)`;
      this.shownSystem = index;
      this.shownRoom = room;
    }

    const sectionKey = section ? section.id : null;
    if (sectionKey !== this.shownSection) {
      this.shownSection = sectionKey;
      this.sectionLabel.textContent = section ? section.label : '';
    }

    const box = L.measures.get(position.measure);
    this.tint.hidden = !box;
    if (box) placeBox(this.tint, box.x, box.systemTop, box.w, box.systemBottom - box.systemTop);

    this.drawLoop(position.loop);
  }

  drawLoop(loop) {
    const key = loop ? `${loop.from}-${loop.to}` : '';
    if (key === this.bandKey) return;
    this.bandKey = key;
    this.bands.forEach((b) => b.remove());
    this.bands = [];
    if (!loop || !this.layout) return;
    for (const row of loopRows(this.layout, loop.from, loop.to)) {
      const band = h('div', { class: 'overlay band' });
      placeBox(band, row.x, row.top, row.w, row.bottom - row.top);
      this.sheet.prepend(band);
      this.bands.push(band);
    }
  }
}

export function placeBox(el, x, y, w, height) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${height}px`;
}

/** The loop's measures as one rectangle per system row. */
export function loopRows(layout, from, to) {
  const rows = [];
  for (const box of layout.boxes) {
    if (box.to < from || box.number > to) continue;
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.top - box.systemTop) < 0.5) {
      last.w = box.x + box.w - last.x;
    } else {
      rows.push({ x: box.x, w: box.w, top: box.systemTop, bottom: box.systemBottom });
    }
  }
  return rows;
}
