// Force landscape (spec §4). The lock is best-effort and silent: a refused or unsupported request
// leaves the music on screen in the current orientation, with no warning, prompt or redirect.
// The manifest stays at orientation "any" so turning the setting off can follow the device.

/**
 * @param {{screen?: object, document?: object, matchMedia?: Function}} env  injected for tests
 */
export function createOrientation({ screen, document, matchMedia } = {}) {
  let appFullscreen = false;
  let generation = 0;

  const orientation = screen && screen.orientation;
  const canLock = () => !!(orientation && typeof orientation.lock === 'function');
  const standalone = () => !!(matchMedia && matchMedia('(display-mode: standalone)').matches);

  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) appFullscreen = false;
    });
  }

  /**
   * Requests the landscape lock. A user-triggered request may enter fullscreen first, because a
   * browser tab only allows the lock in fullscreen. Resolves to true if the lock took.
   */
  async function lock({ userInitiated = false } = {}) {
    const mine = ++generation;
    if (!canLock()) return false;
    let enteredHere = false;
    const root = document && document.documentElement;
    if (userInitiated && !standalone() && document && !document.fullscreenElement && root && typeof root.requestFullscreen === 'function') {
      try {
        await root.requestFullscreen();
        appFullscreen = true;
        enteredHere = true;
      } catch {
        // Fullscreen refused; the lock may still be allowed (an installed app, for example).
      }
    }
    if (mine !== generation) return false; // turned off while fullscreen was opening
    try {
      await orientation.lock('landscape');
      return true;
    } catch {
      // Refused: stay in the current orientation, and don't leave behind a fullscreen we opened.
      if (enteredHere && mine === generation) await unlock();
      return false;
    }
  }

  /** Unlocks immediately and leaves fullscreen only if this module entered it. */
  async function unlock() {
    generation++;
    try {
      if (orientation && typeof orientation.unlock === 'function') orientation.unlock();
    } catch {
      // Nothing was locked.
    }
    if (appFullscreen && document && document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      appFullscreen = false;
      try {
        await document.exitFullscreen();
      } catch {
        // Already left.
      }
    }
    appFullscreen = false;
  }

  return {
    lock,
    unlock,
    /** Applies the persisted setting; never throws and never blocks the player. */
    apply(force, options) {
      return force ? lock(options) : unlock().then(() => false);
    },
    get appFullscreen() { return appFullscreen; },
  };
}
