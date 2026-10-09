// Sheets and the Whole Score screen as history entries (spec §7 "Back gesture"): opening one
// pushes an entry, and Android Back (or browser Back) closes it and nothing more. From the player
// with nothing open, Back leaves the app as normal.

export function createLayers() {
  const registry = new Map(); // name → {show(), hide()}
  let current = null;

  const isOurs = (state) => state && typeof state === 'object' && typeof state.layer === 'string';

  // A reload with a sheet open would otherwise restore a stale entry.
  if (isOurs(history.state)) history.replaceState(null, '');

  function hide(name) {
    const layer = registry.get(name);
    if (layer) layer.hide();
    if (current === name) current = null;
  }

  window.addEventListener('popstate', (event) => {
    const wanted = isOurs(event.state) ? event.state.layer : null;
    if (current && current !== wanted) hide(current);
    if (wanted && wanted !== current && registry.has(wanted)) {
      current = wanted;
      registry.get(wanted).show();
    }
  });

  return {
    register(name, layer) {
      registry.set(name, layer);
    },

    open(name) {
      if (current === name) return;
      if (current) {
        // Swapping one layer for another (view menu → Whole Score) keeps one history entry.
        registry.get(current).hide();
        history.replaceState({ layer: name }, '');
      } else {
        history.pushState({ layer: name }, '');
      }
      current = name;
      registry.get(name).show();
    },

    /** Closes a layer through history, so Back and the on-screen close stay in step. */
    close(name = current) {
      if (!name || current !== name) return;
      if (isOurs(history.state) && history.state.layer === name) history.back();
      else hide(name);
    },

    /**
     * The platform closed a layer on its own (a dialog's close watcher can consume Android Back
     * without a history step); drop the entry it left behind.
     */
    closedExternally(name) {
      if (current !== name) return;
      current = null;
      if (isOurs(history.state) && history.state.layer === name) history.back();
    },

    get current() { return current; },
  };
}
