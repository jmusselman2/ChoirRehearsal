// Measure Follow-Along (spec §6): one long line of the tenor part that scrolls continuously under
// a fixed playhead (centred in portrait, a third of the way in across a landscape screen; CSS
// places it), with the faded next measures below in portrait. The staff is one size per phone
// (staff-size.js), and the next line grows to fill the room the view has. Measure, rest countdown, phrase and loop all come from the
// timing Position; the only arithmetic here is placing that measure's progress on its rendered
// width.

import { h, formatRange } from '../format.js';
import { renderScore, fetchScoreXml, forgetScoreXml } from '../score/osmd.js';
import { NUMBER_BAND, LYRIC_PAD, BASE_HEIGHT, SCALE_STEP, phoneStaffScale, stepScale } from '../score/staff-size.js';
import { placeBox } from './score-card.js';
import { UNSYNCED_NOTICE } from './score.js';
import { countdownText } from './score-lyrics.js';

// The faded next line is at least this scale, and grows into spare height in portrait up to
// full size, so a tall screen spends its room on the music ahead instead of empty space.
const NEXT_SCALE_MIN = 0.62;

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
    this.body = h('div', { class: 'mv' },
      h('div', { class: 'mv-head' }, this.lineLabel, this.numLabel, this.secLabel), this.card, this.lyric);
    el.append(this.notice, this.body);
    this.visible = false;
    this.ctx = null;
    this.layout = null;
    this.state = 'idle';
    this.renderToken = 0;
    this.loopKey = '';
    this.lyricKey = '';
    this.nextScale = NEXT_SCALE_MIN;
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.layout = null;
    this.renderToken++;
    this.svgHolder.textContent = '';
    this.nextStrip.textContent = '';
    this.stale = false;
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
  resize() { if (this.visible) this.ensureRendered(); }

  /** Height the view's contents take, including gaps and padding. */
  usedHeight() {
    const style = getComputedStyle(this.body);
    const children = [...this.body.children];
    return children.reduce((sum, c) => sum + c.offsetHeight, 0)
      + (Number.parseFloat(style.rowGap) || 0) * (children.length - 1)
      + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  }

  /**
   * The phone's staff size, from its screen (staff-size.js), so rotating, going fullscreen or the
   * address bar coming and going never redraws the ribbon. Only if this view can't hold that size
   * (a loop banner on a short landscape screen, say) does it step down to what fits. CSS's
   * --ribbon-lines is how many ribbon heights the view must hold (portrait: plus the next line).
   */
  targetScale() {
    const phone = phoneStaffScale(screen.width, screen.height);
    if (!this.body.clientHeight) return this.layout ? this.layout.scale : phone;
    const lines = Number.parseFloat(getComputedStyle(this.body).getPropertyValue('--ribbon-lines')) || 1;
    const ribbon = this.viewport.offsetHeight + this.next.offsetHeight + this.loading.offsetHeight;
    const room = this.body.clientHeight - (this.usedHeight() - ribbon) - NUMBER_BAND;
    const baseHeight = (this.layout ? this.layout.height / this.layout.scale : BASE_HEIGHT) + LYRIC_PAD;
    return Math.min(phone, stepScale(room / (baseHeight * lines)));
  }

  /** Sizes the faded next line to the height the view has spare. Landscape hides that line. */
  fitNext() {
    if (!this.layout || !this.body.clientHeight || !this.next.offsetParent) return;
    const room = this.next.offsetHeight + this.body.clientHeight - this.usedHeight();
    const full = this.layout.height + this.lyricPad; // the next line keeps paper under its lyrics too
    this.nextScale = Math.min(1, Math.max(NEXT_SCALE_MIN, room / full));
    this.next.style.height = `${Math.ceil(full * this.nextScale)}px`;
  }

  retry() {
    if (!this.ctx || !this.ctx.scoreUrl) return;
    forgetScoreXml(this.ctx.scoreUrl);
    this.setState('loading');
    this.ensureRendered();
  }

  /** Renders the ribbon at the staff size the view has room for, again when that size changes. */
  async ensureRendered() {
    const ctx = this.ctx;
    if (!this.visible || !ctx || !ctx.scoreUrl || this.state === 'failed') return;
    const scale = this.targetScale();
    if (this.layout && Math.abs(scale - this.layout.scale) < SCALE_STEP / 2) {
      this.fitNext();
      return;
    }
    if (this.busyToken === this.renderToken) {
      this.stale = true; // check again once this render lands
      return;
    }
    const token = ++this.renderToken;
    this.busyToken = token;
    this.stale = false;
    // Draw off to the side, so a new size swaps the ribbon in instead of blanking it.
    const holder = h('div', { class: 'rb-render' });
    this.el.append(holder);
    let placed = false;
    try {
      const xml = await fetchScoreXml(ctx.scoreUrl);
      if (token !== this.renderToken) return;
      const layout = await renderScore(holder, xml, { layout: 'line', partId: ctx.partId, scale });
      if (token !== this.renderToken) return;
      holder.className = '';
      this.svgHolder.replaceWith(holder);
      this.svgHolder = holder;
      placed = true;
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
      // The strip's full height: numbers above, the SVG, and some paper under the lyrics.
      this.lyricPad = Math.round(LYRIC_PAD * layout.scale);
      this.stripHeight = NUMBER_BAND + layout.height + this.lyricPad;
      this.viewport.style.height = `${this.stripHeight}px`;
      this.loopKey = ''; // the loop band is redrawn at the new size
      this.setState('ready');
      this.fitNext();
    } catch (error) {
      if (token !== this.renderToken) return;
      console.error('Ribbon render failed:', error);
      this.setState('failed');
    } finally {
      if (!placed) holder.remove();
      if (token === this.renderToken) {
        this.busyToken = 0;
        if (this.stale) this.ensureRendered();
      }
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
      this.nextStrip.style.transform = `scale(${this.nextScale})`;
      this.tint.hidden = true;
      return;
    }
    this.viewport.classList.remove('free');
    this.playhead.hidden = false;
    this.next.hidden = false;
    const anchor = this.playhead.offsetLeft + 1; // the playhead's centre line

    const x = this.playheadX(position, ctx.timeline);
    this.strip.style.transform = `translate3d(${anchor - x}px,0,0)`;
    // The faded next line starts where the current line's right edge is.
    this.nextStrip.style.transform = `translate3d(${-(x + width - anchor) * this.nextScale + 8}px,0,0) scale(${this.nextScale})`;

    const box = L.measures.get(position.measure);
    this.tint.hidden = !box;
    if (box) placeBox(this.tint, box.x, 0, box.w, this.stripHeight);

    // The entrance measure stays faded until "enters in 1" (spec §6).
    const entranceBox = rest && rest.entrance !== null ? L.measures.get(rest.entrance) : null;
    this.fade.hidden = !(entranceBox && rest.countdown > 1);
    if (!this.fade.hidden) placeBox(this.fade, entranceBox.x, 0, entranceBox.w, this.stripHeight);

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
