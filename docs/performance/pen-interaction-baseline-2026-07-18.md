# Sustained Pen interaction baseline — 2026-07-18

## Result

The reported slowdown is reproducible as two bounded costs, not as an observed
listener, DOM, or retained-heap leak:

1. Pen hover and held gestures publish at raw pointer frequency and repeatedly
   redraw the full Konva layer. A five-second held drag produced 484 clears,
   21,783 strokes, and 19,361 fills.
2. A burst of committed points while persistence is connected triggers two
   multi-second source-service/validation stalls. These dominate the accelerated
   commit scenario and are distinct from hover/preview work.

The Bézier V2 changes do not regress either cost. The corrected apples-to-apples
start and post-change runs have identical hover and held-drag draw counts and
the same commit p95 within measurement resolution. Issue #113 tracks preview
coalescing as a non-blocking follow-up.

## Environment

- Starting source: `6f81421` (exported to a disposable directory so the baseline
  could be rerun after implementation)
- Changed source: `codex/pen-performance-bezier-v2`
- Font: a fresh disposable copy of `fonts/workbench-sans`
- Glyph: `O`, initially 6 contours and 24 points across the Text and Heavy
  masters
- Browser: Playwright Chromium 147.0.0.0, 1280 × 720
- Host: Linux on aarch64
- Server: direct `font dev` bundle, without the package watch wrapper
- Persistence: connected same-origin source service
- Canvas zoom: 100%

The direct server exercises the browser bundle shipped by the CLI while avoiding
watch/HMR work. The repository does not expose a separate static production
preview; the comparison therefore isolates browser interaction work from the
watch wrapper rather than claiming a second serving architecture.

## Reproduction

1. Export the commit under test to a disposable directory, install from the
   lockfile, run `pnpm build`, and start `font dev workbench-sans` against a
   disposable project copy.
2. Open Chromium at 1280 × 720, double-click the first `O`, and explicitly click
   **Pen tool**. Keyboard activation is intentionally avoided so textarea focus
   cannot invalidate the comparison.
3. Patch `CanvasRenderingContext2D.stroke`, `fill`, and `clearRect` with counting
   wrappers. Observe `longtask`, sample `requestAnimationFrame`, and record
   `performance.memory`, canvas count, and DOM count at each checkpoint.
4. Capture five seconds idle; move through 240 hover positions; hold one Pen
   drag through 240 positions; then author 48 points with every third point a
   curve drag.
5. Reload the completed glyph, force a Chrome heap collection, wait three
   seconds, and record heap/DOM/canvas cardinality.
6. Repeat unchanged on the implementation branch. The exact fixture script and
   raw values are preserved in the adjacent JSON file.

The accelerated 48-commit phase deliberately stresses the same history and
persistence seams that a several-minute manual session reaches. A separate
manual Playwright pass exercised ordinary clicks, curve drags, open-contour
resumption from both endpoints, closure, Undo/Redo, and cancellation throughout
the implementation session; no progressive control/listener duplication was
visible.

## Measurements

| Scenario             | Start p95 / max |   V2 p95 / max | Start clears | V2 clears | Observation                     |
| -------------------- | --------------: | -------------: | -----------: | --------: | ------------------------------- |
| Idle, 5 s            |  16.7 / 16.8 ms | 16.7 / 16.8 ms |            4 |         4 | Stable                          |
| Hover, 240 moves     | 16.7 / 166.6 ms | 16.8 / 16.8 ms |          432 |       432 | Raw-event redraw amplification  |
| Held drag, 240 moves |  16.8 / 66.7 ms | 16.7 / 66.6 ms |          484 |       484 | No V2 regression                |
| 48 mixed commits     | 66.7 / 133.3 ms |  66.7 / 150 ms |          190 |       182 | Connected persistence dominates |

The commit runs had 42 and 41 missed frames respectively. Each contained 36
long tasks, including paired 2.9–3.3 second stalls. Because these appear only
during the persistence-heavy commit burst—not hover or held preview—they are
attributed with high confidence to connected source assembly, validation, and
write acknowledgement rather than Konva preview rendering.

Used heap reached 117.4 MB on the start commit and 105.6 MB after V2 during the
stress burst. Reload plus forced collection returned the start run to 39.5 MB.
One canvas remained present, and the post-reload DOM contained 310 nodes. This
is evidence against an unbounded session/listener leak; history, transient
allocations, and the enlarged glyph explain the pre-reload delta.

## Ranked findings

1. **Pointer-frequency full-layer redraw — high confidence.** Clear/draw counts
   scale with pointer events even though the display cannot present more than
   one frame at a time. Coalescing to animation frames should reduce CPU and is
   tracked by #113 (size M, correctness risk concentrated in pointer-up and
   cancellation ordering).
2. **Connected commit persistence/validation bursts — high confidence.** These
   produce the worst frames in the accelerated scenario. They are topology and
   commit-rate dependent, not a preview leak. Startup work already established
   source-service instrumentation; a future commit-specific trace should reuse
   it before changing persistence semantics.
3. **Retained listener/DOM/heap growth — not observed.** Canvas and DOM
   cardinality stayed stable, and reload/GC recovered heap. Confidence is medium
   because Chrome heap-retainer files are not portable through the browser
   harness; no leak claim is made without such retainer evidence.

## Regression budget

Until #113 lands, the repeatable budget is parity with `6f81421`: a 240-move
held drag should not exceed 484 canvas clears or regress p95 beyond the baseline
run's 16.8 ms under the environment above. Bézier V2 meets that budget exactly.
Commit-time budgets remain separate because connected persistence introduces
multi-second work that preview scheduling cannot fix.
