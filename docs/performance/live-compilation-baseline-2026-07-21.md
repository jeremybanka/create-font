# Live font compilation baseline — 2026-07-21

Issue #185's repeatable benchmark uses the editor demo font, edits the first
point in glyph `O`'s Razor master back and forth by one font unit, and waits for
new SFNT bytes after every edit. Run it with:

```sh
pnpm --filter @create-font/editor profile:live-font
```

The baseline environment was Linux 7.1.4 on a six-vCPU aarch64 host with Node
26.5.0. Forty warm edits produced a 6.27 ms median and 8.59 ms p95 from editor
state change to new font bytes; the maximum was 11.83 ms. The timing includes
atom.io projection/ingestion and deterministic serialization. It excludes
`FontFace.load()` and browser paint because those are browser scheduling costs;
Preview tiles expose those measurements as `data-activation-ms` and
`data-paint-ms`, alongside `data-compilation-ms`, for Playwright capture.

The command deliberately reports raw samples and has no portable wall-clock
test assertion. Deterministic tests separately verify per-glyph projection
reuse, stale-result suppression, last-known-good recovery, and font-resource
cleanup.
