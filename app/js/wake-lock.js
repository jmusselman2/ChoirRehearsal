// Keep screen on while playing (spec §11): a Screen Wake Lock held only while audio plays and
// the page is visible. The browser drops it when the page hides, so it's re-requested on return.

export function createWakeLock({ navigator, document }) {
  let sentinel = null;
  let pending = false;
  let wanted = false;

  const supported = () => !!(navigator && navigator.wakeLock && typeof navigator.wakeLock.request === 'function');

  function request() {
    if (!wanted || sentinel || pending || !supported() || document.visibilityState !== 'visible') return;
    pending = true;
    navigator.wakeLock.request('screen').then((s) => {
      pending = false;
      if (!wanted) { s.release(); return; }
      sentinel = s;
      s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    }, () => { pending = false; });
  }

  function release() {
    if (sentinel) {
      const s = sentinel;
      sentinel = null;
      s.release().catch(() => {});
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') request();
  });

  return {
    /** @param {boolean} enabled the Keep screen on setting  @param {boolean} playing */
    update(enabled, playing) {
      wanted = enabled && playing;
      if (wanted) request();
      else release();
    },
    get held() { return sentinel !== null; },
  };
}
