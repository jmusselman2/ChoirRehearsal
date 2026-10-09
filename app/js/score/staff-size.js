// The Measure ribbon's staff size (spec §6). Each phone gets one size, worked out from its screen,
// which doesn't change when it rotates, goes fullscreen or shows Chrome's address bar, so none of
// those redraw the ribbon at a new size. No DOM code: the player and the tests share it.

export const NUMBER_BAND = 14; // px above the SVG for printed measure numbers
export const LYRIC_PAD = 16; // px of paper under the lyrics at a 30 px staff; scales with the staff
export const BASE_HEIGHT = 132; // the ribbon SVG's height at 30 px (Alleluia, the tallest but one)
export const MEASURE_WIDTH = 150; // a typical measure's width at 30 px
export const SCALE_MAX = 1.6;
export const SCALE_STEP = 0.05;

// The tightest layout is a landscape Chrome tab with its address bar showing. Around the ribbon
// it has the status bar and Chrome's toolbar (85 px on the Pixel 7), the app header (48) and
// control row (61), and the view's padding, head row, gaps and one-line lyric (62), plus a little
// slack for toolbars that run taller.
const BROWSER_CHROME = 85;
const LANDSCAPE_AROUND = 48 + 61 + 62;
const SLACK = 8;
const PORTRAIT_GUTTERS = 32;
const PORTRAIT_MEASURES = 2; // the next line below carries the look-ahead
const LANDSCAPE_MEASURES = 4.5;

/** Rounds down to a 5% step within 1–1.6×. */
export function stepScale(scale) {
  const steps = Math.floor(scale / SCALE_STEP + 1e-6);
  return Math.min(SCALE_MAX, Math.max(1, Math.round(steps * SCALE_STEP * 100) / 100));
}

/**
 * The phone's staff size: the largest that fits a landscape Chrome tab's height, while about 2
 * typical measures still fit across in portrait and 4½ in landscape. 1.4× on the Pixel 7.
 *
 * @param {number} screenWidth  CSS px, in either orientation
 * @param {number} screenHeight
 */
export function phoneStaffScale(screenWidth, screenHeight) {
  const short = Math.min(screenWidth, screenHeight);
  const long = Math.max(screenWidth, screenHeight);
  if (!(short > 0)) return 1;
  const byHeight = (short - BROWSER_CHROME - LANDSCAPE_AROUND - NUMBER_BAND - SLACK) / (BASE_HEIGHT + LYRIC_PAD);
  const byPortraitWidth = (short - PORTRAIT_GUTTERS) / (PORTRAIT_MEASURES * MEASURE_WIDTH);
  const byLandscapeWidth = long / (LANDSCAPE_MEASURES * MEASURE_WIDTH);
  return stepScale(Math.min(byHeight, byPortraitWidth, byLandscapeWidth));
}
