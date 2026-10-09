// Whole Score (spec §5): the full tenor score to browse by hand. It opens at the current section
// and never scrolls itself after that; "Jump to current section" appears once the user scrolls the
// section out of view and only moves when tapped.

import { h, formatTime } from '../format.js';
import { renderScore, fetchScoreXml, forgetScoreXml } from '../score/osmd.js';

export class WholeScoreView {
  constructor({ root, scroller, jump, playButton, playIcon, songLabel, timeLabel }) {
    Object.assign(this, { root, scroller, jump, playButton, playIcon, songLabel, timeLabel });
    this.paper = h('div', { class: 'paper' });
    this.loading = h('p', { class: 'score-loading', text: 'Loading score…' });
    this.failed = h('div', { class: 'score-failed', hidden: true },
      h('p', { text: 'Score unavailable' }),
      h('button', { type: 'button', class: 'pill-btn', text: 'Retry', onclick: () => this.retry() }));
    this.scroller.append(this.paper);
    this.paper.append(this.loading, this.failed);
    this.ctx = null;
    this.layout = null;
    this.renderedWidth = 0;
    this.renderToken = 0;
    this.visible = false;
    this.sectionKey = null;
    this.lastPosition = null;
    this.jump.addEventListener('click', () => this.scrollToSection(true));
    this.scroller.addEventListener('scroll', () => this.updateJump(), { passive: true });
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.layout = null;
    this.renderedWidth = 0;
    this.renderToken++;
    this.songLabel.textContent = ctx ? ctx.title : '';
    if (this.visible) this.render(true);
  }

  async render(placeAtSection) {
    const ctx = this.ctx;
    this.paper.querySelectorAll('svg, .score-holder').forEach((n) => n.remove());
    this.failed.hidden = true;
    if (!ctx || !ctx.scoreUrl) { this.loading.hidden = true; this.failed.hidden = false; return; }
    const width = this.paper.clientWidth - 8;
    if (width < 50) return;
    const token = ++this.renderToken;
    this.loading.hidden = false;
    // Keep the measure at the top in place across a re-render (rotation).
    const anchor = placeAtSection ? null : this.topMeasure();
    try {
      const xml = await fetchScoreXml(ctx.scoreUrl);
      if (token !== this.renderToken) return;
      const holder = h('div', { class: 'score-holder' });
      this.paper.append(holder);
      this.layout = await renderScore(holder, xml, { layout: 'page', width, partId: ctx.partId });
      if (token !== this.renderToken) return;
      this.renderedWidth = width;
      this.loading.hidden = true;
      this.root.dispatchEvent(new Event('score-ready', { bubbles: true }));
      if (placeAtSection) this.scrollToSection(false);
      else if (anchor !== null) this.scrollToMeasure(anchor);
      this.updateJump();
    } catch (error) {
      if (token !== this.renderToken) return;
      console.error('Whole score render failed:', error);
      this.loading.hidden = true;
      this.failed.hidden = false;
    }
  }

  retry() {
    if (this.ctx && this.ctx.scoreUrl) forgetScoreXml(this.ctx.scoreUrl);
    this.render(true);
  }

  show() {
    this.visible = true;
    this.root.hidden = false;
    this.render(true); // opens at the current section; no scrolling after this
    this.scroller.focus({ preventScroll: true });
  }

  hide() {
    this.visible = false;
    this.root.hidden = true;
  }

  resize() {
    if (!this.visible || !this.layout) return;
    if (Math.abs(this.paper.clientWidth - 8 - this.renderedWidth) > 2) this.render(false);
  }

  /** Called every frame while open. Updates the bar and the jump button, never the scroll. */
  update(frame) {
    this.lastPosition = frame.position;
    this.timeLabel.textContent = formatTime(frame.time);
    this.playIcon.setAttribute('href', frame.playing ? '#i-pause' : '#i-play');
    this.playButton.setAttribute('aria-label', frame.playing ? 'Pause' : 'Play');
    const key = frame.position.timed && frame.position.section ? frame.position.section.id : null;
    if (key !== this.sectionKey) {
      this.sectionKey = key;
      this.updateJump();
    }
  }

  sectionRange() {
    const p = this.lastPosition;
    if (!this.layout || !p || !p.timed) return null;
    const from = p.section ? p.section.from : p.measure;
    const to = p.section ? p.section.to : p.measure;
    const a = this.layout.systemOf(from);
    const b = this.layout.systemOf(to) || a;
    return a ? { top: a.top, bottom: b.bottom } : null;
  }

  /** Where the rendered score starts, in the scroller's content coordinates. */
  sheetOffset() {
    const svg = this.paper.querySelector('.score-holder svg');
    if (!svg) return 0;
    return svg.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
  }

  scrollToSection(smooth) {
    const r = this.sectionRange();
    if (!r) return;
    this.scroller.scrollTo({ top: Math.max(0, this.sheetOffset() + r.top - 12), behavior: smooth ? 'smooth' : 'auto' });
  }

  scrollToMeasure(measure) {
    const s = this.layout && this.layout.systemOf(measure);
    if (s) this.scroller.scrollTop = this.sheetOffset() + s.top;
  }

  topMeasure() {
    if (!this.layout) return null;
    const y = this.scroller.scrollTop - this.sheetOffset();
    const s = this.layout.systems.find((sys) => sys.bottom > y);
    return s ? s.from : null;
  }

  updateJump() {
    const r = this.sectionRange();
    if (!r) { this.jump.hidden = true; return; }
    const top = this.sheetOffset() + r.top - this.scroller.scrollTop;
    const bottom = this.sheetOffset() + r.bottom - this.scroller.scrollTop;
    const visible = bottom > 0 && top < this.scroller.clientHeight;
    this.jump.hidden = visible;
  }
}
