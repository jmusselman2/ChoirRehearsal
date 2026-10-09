// Score view: the current section of the tenor score on a paper card (spec §5).

import { h } from '../format.js';
import { ScoreCard } from './score-card.js';

export const UNSYNCED_NOTICE = 'Timing not set — not synced';

export class ScoreView {
  constructor(el) {
    this.el = el;
    this.card = new ScoreCard();
    this.notice = h('p', { class: 'notice', text: UNSYNCED_NOTICE, hidden: true });
    el.append(this.notice, h('div', { class: 'view-score-body' }, this.card.el));
    this.visible = false;
  }

  setSong(ctx) {
    this.card.setSong(ctx);
    this.notice.hidden = !ctx || ctx.status !== 'ok' || ctx.synced;
    if (this.visible) this.card.ensureRendered();
  }

  show() { this.visible = true; this.card.ensureRendered(); }
  hide() { this.visible = false; }
  resize() { if (this.visible) this.card.ensureRendered(); }

  update(frame) {
    this.notice.hidden = !frame.ctx || frame.ctx.status !== 'ok' || frame.ctx.synced;
    this.card.update(frame.position);
  }
}
