// The OSMD adapter (spec §13, §17): renders the tenor part only, in the clef the MusicXML
// carries, with the compact settings from the renderer test, and reports where each printed
// measure landed so views can draw the playhead, tint and loop band over it.
//
// OSMD is vendored and loaded lazily with a URL relative to this module, so the app works at /
// and at /rehearsal/ and makes no third-party request.

const OSMD_URL = new URL('../../vendor/opensheetmusicdisplay/opensheetmusicdisplay.min.js', import.meta.url);

/** A 30 px staff: four staff spaces of 10 OSMD units × 0.75 (spec §6). The ribbon may scale up. */
export const STAFF_ZOOM = 0.75;

const LINE_SPACING = { VoiceSpacingMultiplierVexflow: 0.55, VoiceSpacingAddendVexflow: 2.0, LyricsXPaddingFactorForLongLyrics: 0.5 };
const PAGE_SPACING = { VoiceSpacingMultiplierVexflow: 0.65, VoiceSpacingAddendVexflow: 2.5, LyricsXPaddingFactorForLongLyrics: 1.0 };

let osmdPromise = null;

export function loadOsmd() {
  if (globalThis.opensheetmusicdisplay) return Promise.resolve(globalThis.opensheetmusicdisplay);
  if (!osmdPromise) {
    osmdPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = OSMD_URL.href;
      script.onload = () => resolve(globalThis.opensheetmusicdisplay);
      script.onerror = () => {
        osmdPromise = null;
        script.remove();
        reject(new Error("The score renderer couldn't load"));
      };
      document.head.append(script);
    });
  }
  return osmdPromise;
}

const xmlCache = new Map();

/** Fetches a MusicXML file once; a failure isn't cached, so Retry fetches again. */
export function fetchScoreXml(url) {
  if (!xmlCache.has(url)) {
    const p = fetch(url, { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
      return res.text();
    });
    p.catch(() => xmlCache.delete(url));
    xmlCache.set(url, p);
  }
  return xmlCache.get(url);
}

export function forgetScoreXml(url) {
  xmlCache.delete(url);
}

/**
 * Renders a score into container.
 *
 * @param {HTMLElement} container  emptied and filled with the SVG
 * @param {string} xml
 * @param {object} options
 * @param {'line'|'page'} options.layout  one horizontal line (the ribbon) or wrapped systems
 * @param {number} [options.width]  page width in px (page layout)
 * @param {string} [options.partId]  the tenor part; other parts are hidden
 * @param {number} [options.scale]  staff size relative to the 30 px staff
 * @returns {Promise<ScoreLayout>}
 */
export async function renderScore(container, xml, { layout, width, partId, scale = 1 }) {
  const lib = await loadOsmd();
  container.textContent = '';
  if (layout === 'page') container.style.width = `${Math.max(200, Math.floor(width))}px`;
  const osmd = new lib.OpenSheetMusicDisplay(container, {
    autoResize: false,
    backend: 'svg',
    drawingParameters: 'compacttight',
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawLyricist: false,
    drawCredits: false,
    drawPartNames: false,
    drawPartAbbreviations: false,
    drawMeasureNumbers: layout === 'page',
    renderSingleHorizontalStaffline: layout === 'line',
    pageFormat: 'Endless',
  });
  await osmd.load(xml);

  // Tenor only: hide every other part if a multi-part file ever arrives (spec §13).
  const instruments = osmd.Sheet.Instruments;
  if (partId && instruments.some((ins) => ins.IdString === partId)) {
    instruments.forEach((ins) => { ins.Visible = ins.IdString === partId; });
  }

  // The ribbon keeps the compact spacing from the renderer test (spec §17). Wrapped systems
  // trade a measure per line for room between syllables: the tight values ran the real
  // Alleluia lyrics together ("mortalthrongsing") on a phone. The clef is never overridden.
  const rules = osmd.EngravingRules;
  Object.assign(rules, layout === 'line' ? LINE_SPACING : PAGE_SPACING);
  // The ribbon reserves the height of its tallest marking for the whole song, and a metronome
  // mark stacked under a tempo word was the tallest in every song (about 25-35 px above the
  // staff). Singers follow the recording's tempo, so the ribbon drops the marks and keeps the
  // words; the page views still show them.
  if (layout === 'line') rules.MetronomeMarksDrawn = false;
  rules.PageLeftMargin = rules.PageRightMargin = 1;
  osmd.zoom = STAFF_ZOOM * scale;
  osmd.render();

  const svg = container.querySelector('svg');
  if (!svg) throw new Error('The score rendered nothing');
  return { ...measureLayout(osmd, svg, 10 * osmd.zoom), scale };
}

function measureLayout(osmd, svg, UNIT) {
  const staffIndex = Math.max(0, osmd.Sheet.Instruments.findIndex((ins) => ins.Visible));
  const measures = new Map(); // printed number → box (px)
  const order = [];
  const rows = osmd.GraphicSheet.MeasureList;
  rows.forEach((row) => {
    const gm = row && (row[staffIndex] || row.find(Boolean));
    if (!gm || !gm.PositionAndShape) return;
    const pos = gm.PositionAndShape.AbsolutePosition;
    const number = gm.MeasureNumber;
    const merged = gm.parentSourceMeasure && gm.parentSourceMeasure.multipleRestMeasures > 1
      ? gm.parentSourceMeasure.multipleRestMeasures
      : 1;
    const system = gm.ParentMusicSystem;
    const sysBox = system ? system.PositionAndShape : null;
    const box = {
      number,
      to: number + merged - 1, // a merged multi-measure rest covers several printed measures
      x: pos.x * UNIT,
      w: gm.PositionAndShape.Size.width * UNIT,
      staffTop: pos.y * UNIT,
      staffBottom: (pos.y + 4) * UNIT,
      systemTop: sysBox ? (sysBox.AbsolutePosition.y + sysBox.BorderMarginTop) * UNIT : 0,
      systemBottom: sysBox ? (sysBox.AbsolutePosition.y + sysBox.BorderMarginBottom) * UNIT : 0,
    };
    for (let m = box.number; m <= box.to; m++) measures.set(m, box);
    order.push(box);
  });

  const systems = [];
  for (const box of order) {
    const last = systems[systems.length - 1];
    if (last && Math.abs(last.top - box.systemTop) < 0.5) {
      last.to = box.to;
    } else {
      systems.push({ top: box.systemTop, bottom: box.systemBottom, from: box.number, to: box.to });
    }
  }

  return {
    svg,
    width: Number.parseFloat(svg.getAttribute('width')) || svg.getBoundingClientRect().width,
    height: Number.parseFloat(svg.getAttribute('height')) || svg.getBoundingClientRect().height,
    measures,
    boxes: order,
    systems,
    systemOf(measure) {
      return systems.find((s) => measure >= s.from && measure <= s.to) || null;
    },
  };
}
