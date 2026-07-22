# Live font compilation baseline — 2026-07-21

Issue #185's repeatable benchmark uses the editor demo font, edits the first
point in glyph `O`'s Razor master back and forth by one font unit, and waits for
new SFNT bytes after every edit. Run it with:

```sh
pnpm --filter @create-font/editor profile:live-font
```

The baseline environment was Linux 7.1.4 on a six-vCPU aarch64 host with Node
26.5.0. After adding the same one-frame queue used in the browser, forty warm
edits produced a 23.37 ms median and 26.62 ms p95 from editor state change to
new font bytes; the maximum was 26.75 ms. The timing includes queueing, atom.io
projection/ingestion, and deterministic serialization. It excludes
`FontFace.load()` and browser paint because those are browser scheduling costs;
Preview tiles expose those measurements as `data-activation-ms` and
`data-paint-ms`, alongside `data-compilation-ms`,
`data-compilation-queue-ms`, `data-projection-ingestion-ms`, and
`data-serialization-ms`, for Playwright capture.

The initial Chromium run exposed a fixture and dependency-graph discrepancy:
warm Workbench Sans edits took 190–212 ms even though deterministic
serialization itself needed only 1–3 ms. CPU profiling localized the cost to
rebuilding atom.io relations for every glyph in the aggregate projection.
Tracking the document revision once while reading cached per-glyph projections
reduced that work to a 20.50 ms median and 22.40 ms p95. Forty browser edits,
including the 16 ms trailing queue, measured 38.60 ms median, 41.40 ms p95, and
45.80 ms maximum from state change to font bytes. A burst of five ArrowRight
edits requested 10 ms apart produced one 44.5 ms compilation instead of five
256–305 ms compilation long tasks. Source persistence is separately debounced
so it cannot win the scheduler race and delay live bytes.

The command deliberately reports raw samples and has no portable wall-clock
test assertion. Deterministic tests separately verify per-glyph projection
reuse, stale-result suppression, last-known-good recovery, and font-resource
cleanup.
