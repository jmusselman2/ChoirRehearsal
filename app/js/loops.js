// Practice loops: an inclusive measure range that wraps from its end time to its exact start
// (spec §9). The time range comes from timing.js; this module only decides when to seek.
// No DOM code, so it runs under node --test.

export const LOOP_OFF = 'off';
export const LOOP_ACTIVE = 'active';
export const LOOP_SUSPENDED = 'suspended';

export function createLoopController() {
  let loop = null;
  let range = null;
  let status = LOOP_OFF;

  const inside = (t) => range !== null && t >= range.start && t < range.end;

  return {
    get loop() { return loop; },
    get range() { return range; },
    get status() { return status; },
    get state() { return { loop, range, status }; },

    /**
     * Starts a loop. Returns the time to seek to, or null when playback is already inside it.
     * @param {object} newLoop  the loop from the song file
     * @param {{start: number, end: number}} newRange  from Timeline.loopRange()
     * @param {number} currentTime
     */
    start(newLoop, newRange, currentTime) {
      loop = newLoop;
      range = newRange;
      status = LOOP_ACTIVE;
      return inside(currentTime) ? null : range.start;
    },

    stop() {
      loop = null;
      range = null;
      status = LOOP_OFF;
    },

    /** Called on every timeupdate (and animation frame). Returns a wrap target or null. */
    check(currentTime) {
      if (status !== LOOP_ACTIVE) return null;
      return currentTime >= range.end ? range.start : null;
    },

    /** A user seek or skip. Landing outside the loop suspends it until the next Play. */
    userSeek(target) {
      if (status === LOOP_ACTIVE && !inside(target)) status = LOOP_SUSPENDED;
    },

    /** The Play command. A suspended loop resumes from its start; returns that seek target. */
    play() {
      if (status !== LOOP_SUSPENDED) return null;
      status = LOOP_ACTIVE;
      return range.start;
    },

    /** The audio reached its end. An active loop wins over Repeat; returns the wrap target. */
    ended() {
      return status === LOOP_ACTIVE ? range.start : null;
    },
  };
}
