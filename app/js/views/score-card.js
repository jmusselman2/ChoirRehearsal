// The paper card that shows the current section's tenor systems (spec §5, Score and Score +
// Lyrics). Every musical value comes from the timing Position; this file only maps measures onto
// the rendered systems.

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
      this.sheet.style.transform = '';
      this.sheet.style.clipPath = '';
      this.tint.hidden = true;
      this.sectionLabel.textContent = '';
      return;
    }
    this.window.classList.remove('free');
    const section = position.section;
    const from = section ? section.from : position.measure;
    const to = section ? section.to : position.measure;
    const first = L.systemOf(from) || L.systemOf(position.measure);
    const last = L.systemOf(to) || first;
    const current = L.systemOf(position.measure) || first;
    if (!first) return;

    let top = first.top;
    const bottom = last.bottom;
    const room = this.window.clientHeight;
    if (bottom - top > room && current) {
      // A long section: keep the current system in view, as near the section start as possible.
      top = Math.min(Math.max(current.top, top), Math.max(top, bottom - room));
    }
    this.sheet.style.transform = `translateY(${-top}px)`;
    this.sheet.style.clipPath = `inset(${top}px 0 ${Math.max(0, L.height - bottom)}px 0)`;

    const sectionKey = section ? section.id : null;
    if (sectionKey !== this.shownSection) {
      if (this.shownSection !== undefined && !prefersReducedMotion()) {
        this.sheet.classList.remove('fade');
        void this.sheet.offsetWidth; // restart the cross-fade
        this.sheet.classList.add('fade');
      }
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
