# OpenSheetMusicDisplay 2.2.0 (vendored)

The MusicXML renderer chosen in `docs/spec.md` §17, served from this folder so the player works
offline and makes no third-party requests.

| File | What it is |
| --- | --- |
| `opensheetmusicdisplay.min.js` | The unmodified browser build from the npm package |
| `LICENSE` | OSMD's BSD-3-Clause license |
| `AUTHORS` | OSMD's authors list |
| `THIRD-PARTY-NOTICES.txt` | Licenses of the libraries the build bundles (VexFlow, JSZip, pako, loglevel, typescript-collections) |

Provenance:

- Package: `opensheetmusicdisplay@2.2.0`, `https://registry.npmjs.org/opensheetmusicdisplay/-/opensheetmusicdisplay-2.2.0.tgz`
- npm integrity: `sha512-KUJ1OXhjGZP3n1ZTkLoEotL7+g4pQts9jSICY1I1WvShPI7F4Lr6G9Hqmmaoo1jNAaQB89Zy2yOC+mEquv6OuQ==`
- `opensheetmusicdisplay.min.js` SHA-256: `86e439e5ec1c0cbf8b7051e0cf32291d377fb97cf6b8976b9ef87c714e0ca032`

To refresh it, from the repo root:

```powershell
npm pack opensheetmusicdisplay@2.2.0
tar -xzf opensheetmusicdisplay-2.2.0.tgz
Copy-Item package\build\opensheetmusicdisplay.min.js, package\LICENSE, package\AUTHORS app\vendor\opensheetmusicdisplay\
```

The player loads it lazily with a relative URL (`js/score/osmd.js`), only when a score view needs it.
