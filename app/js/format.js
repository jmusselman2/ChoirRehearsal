// Display formatting shared by the views. No timing logic lives here.

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const formatSpeed = (rate) => `${rate.toFixed(1)}×`;

export const formatRange = (from, to) => (from === to ? `m. ${from}` : `m. ${from}–${to}`);

export const VIEW_LABELS = {
  score: 'Score',
  lyrics: 'Lyrics',
  'score-lyrics': 'Score + Lyrics',
  measure: 'Measure',
};

/** Creates an element; text content only, so content-file strings are never parsed as HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const prefersReducedMotion = () => globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
