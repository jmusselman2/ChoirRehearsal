// Mock CONFIG for the rehearsal PoC.
// Copy to config.js (gitignored) and edit there.
// Times are in seconds of media time.
// Score boxes are percentages of the image.

window.CONFIG = {
  artist: "Tenor rehearsal", // TODO: replace
  album: "Tenor Choir · Fall 2026",

  // Lock-screen artwork. A PNG is more reliable than SVG on Android.
  artwork: [
    { src: "mock/artwork.png", sizes: "512x512", type: "image/png" }
  ],

  // What happens when a track ends: true (the default) plays the next track,
  // stopping after the last; false stops. Prev/Next always step between tracks.
  continueToNext: true,

  tracks: [
    { id: "test1", title: "Test 1", src: "audio/test1.mp3" }, // TODO: replace
    { id: "test2", title: "Test 2", src: "audio/test2.mp3" }, // TODO: replace
    { id: "test3", title: "Test 3", src: "audio/test3.mp3" }, // TODO: replace
    { id: "test4", title: "Test 4", src: "audio/test4.mp3" }  // TODO: replace
  ],

  // Practice loops, keyed by track id. from/to are seconds of media time.
  loops: {
    test1: [
      { name: "Bridge entrance", from: 150.00, to: 167.00, note: "Count the rest, come in clean." }, // TODO: replace
      { name: "Final hold",      from: 205.00, to: 220.00, note: "Hold through the fermata." }       // TODO: replace
    ]
  },

  // Follow-along data, keyed by track id.
  // Only test1 is wired up.
  follow: {
    test1: {
      // TODO: replace (placeholder lines, times spread evenly over 224.03 s)
      lyrics: [
        { t: 0,      text: "Lyric line 1" },  // TODO: replace
        { t: 18.67,  text: "Lyric line 2" },  // TODO: replace
        { t: 37.34,  text: "Lyric line 3" },  // TODO: replace
        { t: 56.01,  text: "Lyric line 4" },  // TODO: replace
        { t: 74.68,  text: "Lyric line 5" },  // TODO: replace
        { t: 93.35,  text: "Lyric line 6" },  // TODO: replace
        { t: 112.02, text: "Lyric line 7" },  // TODO: replace
        { t: 130.68, text: "Lyric line 8" },  // TODO: replace
        { t: 149.35, text: "Lyric line 9" },  // TODO: replace
        { t: 168.02, text: "Lyric line 10" }, // TODO: replace
        { t: 186.69, text: "Lyric line 11" }, // TODO: replace
        { t: 205.36, text: "Lyric line 12" }  // TODO: replace
      ],
      score: {
        image: "mock/score-placeholder.svg", // TODO: replace (e.g. "score/test1-p1.png")

        // One box per system on the page, switching at each section start.
        sections: [
          { t: 0,      x: 5.65, y: 13.68, w: 88.71, h: 16.19 }, // TODO: replace
          { t: 44.81,  x: 5.65, y: 30.22, w: 88.71, h: 16.19 }, // TODO: replace
          { t: 89.61,  x: 5.65, y: 46.75, w: 88.71, h: 16.19 }, // TODO: replace
          { t: 134.42, x: 5.65, y: 63.28, w: 88.71, h: 16.19 }, // TODO: replace
          { t: 179.23, x: 5.65, y: 79.82, w: 88.71, h: 16.19 }  // TODO: replace
        ]
      }
    }
  }
};
