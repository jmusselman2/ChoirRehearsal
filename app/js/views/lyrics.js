// Lyrics view (spec §5): sections of phrases, the current one centred and marked. The list follows
// playback until the user scrolls it; the Follow pill resumes following.

import { h, prefersReducedMotion } from '../format.js';
import { UNSYNCED_NOTICE } from './score.js';
import { countdownText } from './score-lyrics.js';

export class LyricsView {
  constructor(el) {
    this.el = el;
    this.notice = h('p', { class: 'notice', text: UNSYNCED_NOTICE, hidden: true });
    this.list = h('div', { class: 'lyr-list' });
    this.scroller = h('div', { class: 'lyr-scroll', tabindex: '0', 'aria-label': 'Lyrics' },
      h('div', { class: 'lyr-pad' }), this.list, h('div', { class: 'lyr-pad' }));
    this.followBtn = h('button', { type: 'button', class: 'follow', text: 'Follow', hidden: true, onclick: () => this.resumeFollow() });
    el.append(this.notice, this.scroller, this.followBtn);
    this.following = true;
    this.visible = false;
    this.ctx = null;
    this.blocks = [];
    this.lines = new Map();
    this.currentKey = '';

    // Only a person scrolls with these; programmatic scrolling doesn't fire them.
    const manual = () => {
      if (!this.ctx || !this.ctx.synced) return;
      this.following = false;
      this.followBtn.hidden = false;
    };
    this.scroller.addEventListener('wheel', manual, { passive: true });
    this.scroller.addEventListener('touchmove', manual, { passive: true });
    this.scroller.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) manual();
    });
    this.scroller.addEventListener('pointerdown', (e) => {
      // A drag on the scrollbar itself.
      if (e.pointerType === 'mouse' && e.offsetX > this.scroller.clientWidth) manual();
    });
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.following = true;
    this.followBtn.hidden = true;
    this.currentKey = '';
    this.blocks = [];
    this.lines = new Map();
    this.list.textContent = '';
    if (!ctx || ctx.status !== 'ok') return;
    this.notice.hidden = ctx.synced;
    const song = ctx.song;
    for (const section of song.sections) {
      const phrases = ctx.phrases.filter((p) => p.section === section.id);
      const block = h('section', { class: 'lsec', dataset: { section: section.id } },
        h('h3', { class: 'lsec-label', text: section.label }));
      const countdown = h('p', { class: 'lline countdown-line', hidden: true });
      block.append(countdown);
      if (phrases.length === 0) {
        block.append(h('p', { class: 'lline quiet', text: ctx.restSections.has(section.id) ? 'Tenor rests' : 'Lyrics unavailable for this section' }));
      }
      for (const p of phrases) {
        const line = h('p', { class: 'lline', text: p.text });
        this.lines.set(p.id, line);
        block.append(line);
      }
      this.blocks.push({ id: section.id, el: block, countdown });
      this.list.append(block);
    }
    this.scroller.scrollTop = 0;
  }

  show() {
    this.visible = true;
    this.currentKey = ''; // re-centre on the next frame
  }
  hide() { this.visible = false; }
  resize() { this.currentKey = ''; }

  resumeFollow() {
    this.following = true;
    this.followBtn.hidden = true;
    this.currentKey = '';
    this.scrollToCurrent(true);
  }

  update(frame) {
    const { ctx, position } = frame;
    if (!ctx || ctx.status !== 'ok' || !position.timed) {
      this.followBtn.hidden = true;
      return;
    }
    const sectionId = position.section ? position.section.id : null;
    const phraseId = position.phrase ? position.phrase.id : null;
    const restKey = position.rest ? `${position.rest.countdown}` : '';
    const nextId = position.rest && position.nextPhrase ? position.nextPhrase.id : null;
    const key = `${sectionId}|${phraseId}|${restKey}|${nextId}`;
    if (key === this.currentKey) return;
    const sectionChanged = !this.currentKey.startsWith(`${sectionId}|`);
    this.currentKey = key;

    for (const b of this.blocks) {
      const isCurrent = b.id === sectionId;
      b.el.classList.toggle('current', isCurrent);
      b.countdown.hidden = true;
    }
    for (const [id, line] of this.lines) line.classList.toggle('current', id === phraseId);

    // During a rest, the current section shows the countdown, just above the next phrase when
    // that phrase is in the same section.
    const holder = position.rest ? this.blocks.find((b) => b.id === sectionId) : null;
    if (holder) {
      const nextLine = position.nextPhrase && position.nextPhrase.section === sectionId
        ? this.lines.get(position.nextPhrase.id)
        : null;
      if (nextLine) nextLine.before(holder.countdown);
      else holder.el.append(holder.countdown);
      holder.countdown.textContent = countdownText(position.rest);
      holder.countdown.hidden = false;
    }
    if (this.visible && this.following) this.scrollToCurrent(!sectionChanged);
  }

  scrollToCurrent(smooth) {
    const target = this.list.querySelector('.lline.current') || this.list.querySelector('.lsec.current');
    if (!target) return;
    const box = target.getBoundingClientRect();
    const view = this.scroller.getBoundingClientRect();
    const top = this.scroller.scrollTop + (box.top - view.top) - (view.height / 2 - box.height / 2);
    this.scroller.scrollTo({ top, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  }
}
