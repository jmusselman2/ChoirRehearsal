// Measure Follow-Along (spec §6): one long line of the tenor part that scrolls continuously under
// a fixed centre playhead, with the faded next measures below. Measure, rest countdown, phrase and
// loop all come from the timing Position; the only arithmetic here is placing that measure's
// progress on its rendered width.

import { h, formatRange } from '../format.js';
import { renderScore, fetchScoreXml, forgetScoreXml } from '../score/osmd.js';
import { placeBox } from './score-card.js';
import { UNSYNCED_NOTICE } from './score.js';
import { countdownText } from './score-lyrics.js';

const NUMBER_BAND = 14; // px above the SVG for printed measure numbers
const NEXT_SCALE = 0.62;

export class MeasureView {
  constructor(el) {
    this.el = el;
    this.notice = h('p', { class: 'notice', text: UNSYNCED_NOTICE, hidden: true });
    this.lineLabel = h('span', { class: 'mv-line' });
    this.numLabel = h('span', { class: 'mv-num' });
    this.secLabel = h('span', { class: 'mv-sec' });
    this.cue = h('div', { class: 'rb-cue countdown', 'aria-live': 'polite' });
    this.numbers = h('div', { class: 'rb-numbers' });
    this.tint = h('div', { class: 'overlay tint' });
    this.band = h('div', { class: 'overlay band rb-edge', hidden: true });
    this.fade = h('div', { class: 'overlay rb-fade', hidden: true });
    this.svgHolder = h('div');
    this.strip = h('div', { class: 'rb-strip' }, this.tint, this.band, this.numbers, this.svgHolder, this.fade);
    this.playhead = h('div', { class: 'rb-playhead', 'aria-hidden': 'true' });
    this.viewport = h('div', { class: 'rb-viewport' }, this.strip, this.playhead);
    this.nextStrip = h('div', { class: 'rb-next-strip' });
    this.next = h('div', { class: 'rb-next', 'aria-hidden': 'true' }, this.nextStrip);
    this.loading = h('p', { class: 'score-loading', text: 'Loading score…' });
    this.failed = h('div', { class: 'score-failed', hidden: true },
      h('p', { text: 'Score unavailable' }),
      h('button', { type: 'button', class: 'pill-btn', text: 'Retry', onclick: () => this.retry() }));
    this.card = h('div', { class: 'paper ribbon-card' }, this.cue, this.viewport, this.next, this.loading, this.failed);
    this.lyric = h('div', { class: 'mv-lyric' });
    el.append(this.notice, h('div', { class: 'mv' },
      h('div', { class: 'mv-head' }, this.lineLabel, this.numLabel, this.secLabel), this.card, this.lyric));
    this.visible = false;
    this.ctx = null;
    this.layout = null;
    this.state = 'idle';
    this.renderToken = 0;
    this.loopKey = '';
    this.lyricKey = '';
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.layout = null;
    this.renderToken++;
    this.svgHolder.textContent = '';
    this.nextStrip.textContent = '';
    this.numbers.textContent = '';
    this.loopKey = '';
    this.lyricKey = '';
    this.lineLabel.textContent = ctx && ctx.status === 'ok' ? ctx.line : '';
    this.setState(ctx && ctx.scoreUrl ? 'loading' : 'failed');
    if (this.visible) this.ensureRendered();
  }

  setState(state) {
    this.state = state;
    this.loading.hidden = state !== 'loading';
    this.failed.hidden = state !== 'failed';
    this.viewport.hidden = state === 'failed';
    this.viewport.style.visibility = state === 'ready' ? '' : 'hidden';
    this.next.hidden = state !== 'ready';
    if (state === 'ready') this.el.dispatchEvent(new Event('score-ready', { bubbles: true }));
  }

  show() { this.visible = true; this.ensureRendered(); }
  hide() { this.visible = false; }
  resize() {}

  retry() {
    if (!this.ctx || !this.ctx.scoreUrl) return;
    forgetScoreXml(this.ctx.scoreUrl);
    this.setState('loading');
    this.ensureRendered();
  }

  async ensureRendered() {
    const ctx = this.ctx;
    if (!ctx || !ctx.scoreUrl || this.layout || this.state === 'failed' || this.rendering === ctx) return;
    const token = ++this.renderToken;
    this.rendering = ctx;
    try {
      const xml = await fetchScoreXml(ctx.scoreUrl);
      if (token !== this.renderToken) return;
      const layout = await renderScore(this.svgHolder, xml, { layout: 'line', partId: ctx.partId });
      if (token !== this.renderToken) return;
      this.layout = layout;
      this.strip.style.paddingTop = `${NUMBER_BAND}px`;
      this.strip.style.width = `${layout.width}px`;
      this.numbers.textContent = '';
      for (const box of layout.boxes) {
        const label = h('span', { class: 'rb-num', text: String(box.number) });
        label.style.left = `${box.x}px`;
        this.numbers.append(label);
      }
      const clone = layout.svg.cloneNode(true);
      this.nextStrip.replaceChildren(clone);
      this.nextStrip.style.width = `${layout.width}px`;
      this.next.style.height = `${Math.ceil(layout.height * NEXT_SCALE)}px`;
      this.viewport.style.height = `${layout.height + NUMBER_BAND}px`;
      this.setState('ready');
    } catch (error) {
      if (token !== this.renderToken) return;
      console.error('Ribbon render failed:', error);
      this.setState('failed');
    } finally {
      if (token === this.renderToken) this.rendering = null;
    }
  }

  /** x of the playhead within the strip, from the measure and its progress. */
  playheadX(position, timeline) {
    const box = this.layout.measures.get(position.measure);
    if (!box) return 0;
    if (box.to === box.number) return box.x + position.measureProgress * box.w;
    // A merged multi-measure rest: hold on the one wide bar across the whole rest.
    return box.x + timeline.progressThrough(box.number, box.to, position.time) * box.w;
  }

  update(frame) {
    const { ctx, position } = frame;
    if (!ctx || ctx.status !== 'ok') return;
    this.notice.hidden = ctx.synced;
    const rest = position.timed ? position.rest : null;

    // The header and lyric line work even when the ribbon can't render (spec §5).
    if (!position.timed) {
      this.cue.textContent = '';
      this.numLabel.textContent = '';
      this.secLabel.textContent = '';
      this.setLyric('', ctx.phrases[0] ? ctx.phrases[0].text : '', 'static');
    } else {
      this.numLabel.textContent = `m. ${position.measure}`;
      this.secLabel.textContent = position.section ? position.section.label : '';
      // Rest: the countdown above the staff.
      this.cue.textContent = rest ? countdownText(rest) : '';
      if (rest) this.setLyric(countdownText(rest), position.nextPhrase ? position.nextPhrase.text : '', `r${position.measure}`);
      else if (position.phrase) this.setLyric(position.phrase.text, '', `p${position.phraseIndex}`);
      else this.setLyric('', position.nextPhrase ? position.nextPhrase.text : '', `n${position.nextPhraseIndex}`);
    }

    if (this.state !== 'ready' || !this.layout) return;
    const L = this.layout;
    const width = this.viewport.clientWidth;

    if (!position.timed) {
      this.viewport.classList.add('free');
      this.playhead.hidden = true;
      this.next.hidden = true;
      this.strip.style.transform = '';
      this.nextStrip.style.transform = `scale(${NEXT_SCALE})`;
      this.tint.hidden = true;
      return;
    }
    this.viewport.classList.remove('free');
    this.playhead.hidden = false;
    this.next.hidden = false;

    const x = this.playheadX(position, ctx.timeline);
    this.strip.style.transform = `translate3d(${width / 2 - x}px,0,0)`;
    // The faded next line starts where the current line's right edge is.
    this.nextStrip.style.transform = `translate3d(${-(x + width / 2) * NEXT_SCALE + 8}px,0,0) scale(${NEXT_SCALE})`;

    const box = L.measures.get(position.measure);
    this.tint.hidden = !box;
    if (box) placeBox(this.tint, box.x, 0, box.w, L.height + NUMBER_BAND);

    // The entrance measure stays faded until "enters in 1" (spec §6).
    const entranceBox = rest && rest.entrance !== null ? L.measures.get(rest.entrance) : null;
    this.fade.hidden = !(entranceBox && rest.countdown > 1);
    if (!this.fade.hidden) placeBox(this.fade, entranceBox.x, 0, entranceBox.w, L.height + NUMBER_BAND);

    this.drawLoop(position.loop);
  }

  setLyric(current, next, key) {
    if (key === this.lyricKey) return;
    this.lyricKey = key;
    this.lyric.replaceChildren(
      ...(current ? [h('span', { text: current })] : []),
      ...(next ? [h('div', { class: 'sl-next', text: next })] : []),
    );
  }

  drawLoop(loop) {
    const key = loop ? `${loop.from}-${loop.to}` : '';
    if (key === this.loopKey) return;
    this.loopKey = key;
    this.band.hidden = !loop;
    if (!loop) return;
    const a = this.layout.measures.get(loop.from);
    const b = this.layout.measures.get(loop.to);
    if (!a || !b) { this.band.hidden = true; return; }
    // Start and end barlines are drawn 2 dp thicker (spec §6).
    placeBox(this.band, a.x - 1, NUMBER_BAND + a.staffTop, b.x + b.w - a.x + 2, a.staffBottom - a.staffTop);
    this.band.setAttribute('aria-label', `Loop ${formatRange(loop.from, loop.to)}`);
  }
}
