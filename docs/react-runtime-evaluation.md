# React runtime evaluation

This spike ports the create-design and create-font browser editors from Preact
and `@create-art/preact-konva` to React 19.2.8 and `react-konva` 19.2.5. The
comparison uses `main` at `68318f8` as the Preact baseline and this worktree as
the React candidate.

## Recommendation

Adopt the React port, with the initial bundle increase treated as an explicit
cost rather than a performance win.

React wins the long-lived editor workload in this synthetic comparison and
removes a renderer that the project had to design, publish, test, and keep
compatible itself. It also makes the DOM tree, Atom.io bindings, Radix icons,
and Konva tree use one supported runtime. For an installed, long-running design
tool, those advantages outweigh an extra 91.6 KB gzip on initial create-design
JavaScript.

The trade is not close on startup: Preact remains the better choice when
download, parse, memory, or short-lived sessions dominate. Before describing
the scene results as browser-frame improvements, repeat the benchmark with
browser tracing on representative documents; the current harness deliberately
isolates reconciliation and Konva mutations in Happy DOM.

## Runtime benchmark

The checked-in `benchmark:runtime` script mounts 1,000 keyed Konva rectangles,
runs 12 fresh mounts, 60 controlled one-prop updates, 20 complete keyed-order
reversals, and an unmount. Auto-draw is disabled so the measurement compares
renderer and scene-graph work rather than mock canvas drawing. Each value below
is the median of five fresh Node processes; operation values are themselves the
median within each process.

| Measurement         | Preact adapter | React-Konva | Change |
| ------------------- | -------------: | ----------: | -----: |
| Runtime import      |       15.36 ms |    37.83 ms |  +146% |
| Dense mount         |       36.42 ms |    28.95 ms | -20.5% |
| Controlled update   |        6.15 ms |     4.05 ms | -34.2% |
| Keyed reversal      |       11.97 ms |    10.77 ms | -10.0% |
| Unmount             |        5.81 ms |     2.56 ms | -56.0% |
| Retained heap delta |    3,715,824 B | 4,733,312 B | +27.4% |

Lower time and heap values are better. The mount and update advantage is
repeatable in this harness; so are React's roughly 2.5x cold-import time and
additional 1.0 MB retained heap. These numbers are directional, not a claim
about real canvas FPS or browser startup.

## Production artifacts

Sizes are minified bytes with gzip level 9 measured on clean production builds.

| Artifact                              |      Preact |       React | Change |
| ------------------------------------- | ----------: | ----------: | -----: |
| create-design initial JS, raw         |   641,260 B |   949,804 B | +48.1% |
| create-design initial JS, gzip        |   188,530 B |   280,120 B | +48.6% |
| create-design Pathfinder worker, raw  |   107,527 B |    96,082 B | -10.6% |
| create-design Pathfinder worker, gzip |    32,202 B |    27,453 B | -14.7% |
| `@create-design/editor`, raw          | 1,022,869 B | 1,240,773 B | +21.3% |
| `@create-design/editor`, gzip         |   260,873 B |   308,418 B | +18.2% |

The shared editor build now externalizes its declared UI dependencies so a
product bundle includes one React runtime rather than embedding and rebundling
a second copy. Its JavaScript artifact therefore shrinks from 310,579 B raw /
84,253 B gzip to 84,535 B raw / 22,980 B gzip, but that is a packaging shift,
not an end-user size reduction. The create-design application row is the fair
startup comparison.

## Correctness and compatibility

The port passes the shared editor (96 tests), create-design editor (218),
create-font editor (419), create-design app (27), create-font browser interface
(34), create-font source pipeline (19), filesystem E2E (2), and Node server
smoke test (1): 816 passing assertions across the exercised suites.

The new renderer-boundary tests verify controlled prop removal, event-handler
replacement without disturbing external Konva listeners, refs, keyed z-order,
full-size Stage host behavior, unmount destruction, and remount. Existing
product suites continue to cover pointer capture and cancellation, native and
controlled drag paths, selection transforms, text editing, and source-driven
rerenders. The unrelated standalone feature-language-server process test still
exits with status 1 in both baseline and candidate and is not counted above.

## Maintainability and other criteria

- React removes the 0.2.0 local Preact-Konva package and its custom lifecycle,
  prop-diffing, event, ref, and child-order implementation. The replacement is
  a narrow boundary in `@create-art/editor` plus focused compatibility tests.
- One runtime now owns the browser DOM and Konva integration. Preact compat
  aliases, the React island boundary, and cross-runtime values disappear.
- React has the stronger ecosystem fit for Atom.io, Radix, React DevTools, and
  upstream `react-konva`. React's stricter test scheduling also exposed event
  assumptions that Preact tolerated.
- `react-konva` is not risk-free: its major version is coupled to the React
  major and it depends on `react-reconciler`, so upgrades require deliberate
  version alignment and regression tests. The project trades direct ownership
  of a small adapter for reliance on that upstream compatibility work.
- Accessibility is essentially neutral. Konva remains a canvas scene and the
  native DOM controls retain their semantics; this change does not make canvas
  content inherently accessible.
- The dependency tree retains Preact only as a development peer of Lasertag;
  production editor source and artifacts contain React and no Preact runtime.
