// Score + Lyrics, the default view (spec §5): the score card above (or beside, in landscape)
// the current phrase and the next one. The card already names the section, so the lyrics don't
// repeat it. All musical state comes from the timing Position.

import { h } from '../format.js';
import { ScoreCard } from './score-card.js';
import { UNSYNCED_NOTICE } from './score.js';

export function countdownText(rest) {
  return rest && rest.countdown !== null ? `Tenor enters in ${rest.countdown}` : 'Tenor rests';
}

export class ScoreLyricsView {
  constructor(el) {
    this.el = el;
    this.card = new ScoreCard();
    this.notice = h('p', { class: 'notice', text: UNSYNCED_NOTICE, hidden: true });
    this.current = h('p', { class: 'sl-current' });
    this.next = h('p', { class: 'sl-next' });
    this.lyrics = h('div', { class: 'sl-lyrics', 'aria-live': 'off' }, this.current, this.next);
    this.body = h('div', { class: 'sl' }, this.card.el, this.lyrics);
    el.append(this.notice, this.body);
    this.visible = false;
    this.ctx = null;
    this.lastKey = '';
  }

  setSong(ctx) {
    this.ctx = ctx;
    this.lastKey = '';
    this.card.setSong(ctx);
    if (this.visible) this.card.ensureRendered();
  }

  show() { this.visible = true; this.card.ensureRendered(); }
  hide() { this.visible = false; }
  resize() { if (this.visible) this.card.ensureRendered(); }

  update(frame) {
    const { ctx, position } = frame;
    const synced = ctx && ctx.status === 'ok' && ctx.synced;
    this.notice.hidden = !ctx || ctx.status !== 'ok' || synced;
    this.card.update(position);
    if (!ctx || ctx.status !== 'ok') return;

    let key;
    let parts;
    if (!position.timed) {
      // Unsynced: the first phrase as a static cue.
      const first = ctx.phrases[0];
      parts = { current: '', next: first ? first.text : '', noLyrics: !first, quiet: false };
      key = 'static';
    } else if (position.rest) {
      parts = {
        current: countdownText(position.rest),
        countdown: true,
        next: position.nextPhrase ? position.nextPhrase.text : '',
        noLyrics: false,
      };
      key = `r${position.measure}`;
    } else if (position.phrase) {
      parts = {
        current: position.phrase.text,
        next: position.nextPhrase ? position.nextPhrase.text : '',
        noLyrics: false,
      };
      key = `p${position.phraseIndex}`;
    } else {
      const sectionHasLyrics = position.section && ctx.sectionsWithLyrics.has(position.section.id);
      parts = {
        current: sectionHasLyrics ? '' : 'Lyrics unavailable for this section',
        quiet: !sectionHasLyrics,
        next: position.nextPhrase ? position.nextPhrase.text : '',
        noLyrics: !sectionHasLyrics,
      };
      key = `n${position.sectionIndex}-${position.nextPhraseIndex}`;
    }
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.current.textContent = parts.current;
    this.current.className = parts.countdown ? 'countdown' : parts.quiet ? 'sl-quiet' : 'sl-current';
    this.current.hidden = !parts.current;
    this.next.textContent = parts.next;
    this.next.hidden = !parts.next;
    // No lyrics for this section: the score takes the space (spec §5).
    this.body.classList.toggle('no-lyrics', parts.noLyrics);
    this.card.ensureRendered();
  }
}
