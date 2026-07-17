# Initial editor startup baseline — 2026-07-17

## Environment

- Source base: `378274696ed7a141b5cc76d916ad8e3ff92e673d`
- Project: checked-in `fonts/workbench-sans`
- Mode: `font dev`, loopback server, no artificial latency or CPU throttling
- Host: Linux 7.1.3 on aarch64, 6 Apple CPU cores
- Bun: 1.3.14
- Node: 26.5.0
- pnpm: 11.13.1
- Browser: Playwright MCP bundled Chromium (the exact Chromium build was not
  exposed by the tool session)
- Development server: `http://127.0.0.1:4173/`

## Method

Ten cold runs each used a new isolated Playwright `BrowserContext`, ensuring the
HTTP cache and SharedWorker did not survive. Ten warm runs reloaded a second page
while another page kept the source-session SharedWorker alive. Every run waited
for `window.__CREATE_FONT_STARTUP_PROFILE__().status === "editor-usable"`.

Times are milliseconds. p95 uses linear interpolation over the ten samples. The
compact raw rows are checked in beside this report as
[`startup-baseline-2026-07-17.json`](./startup-baseline-2026-07-17.json).

## Results

### Cold worker and HTTP cache (n = 10)

| Metric                          |    p50 |    p95 |         Range |
| ------------------------------- | -----: | -----: | ------------: |
| Navigation → editor usable      | 13,835 | 18,055 | 13,372–21,322 |
| Navigation → source message     | 13,418 | 17,631 | 12,966–20,918 |
| Manifest RPC                    |     69 |    265 |        65–423 |
| 206-unit RPC fan-out wall time  | 12,702 | 16,767 | 12,265–19,903 |
| Source directory assembly       |     16 |     18 |         15–18 |
| Worker validation / compilation |    519 |    554 |       472–557 |
| Main editor hydration / render  |    378 |    413 |       358–417 |
| Main-thread total blocking time |    343 |    381 |       323–384 |
| Worker → main message transit   |   3.15 |   3.62 |     2.90–3.80 |

The 206 source responses transferred 387,137 bytes in every cold sample. The
initial page's static JavaScript (978,729 encoded bytes) loaded in 5.2 ms and CSS
in 2.2 ms on loopback, so asset delivery was not the long loading-screen cost in
this environment.

### Warm SharedWorker (n = 10)

| Metric                             |  p50 |  p95 |      Range |
| ---------------------------------- | ---: | ---: | ---------: |
| Navigation → editor usable         |  338 |  359 |    320–364 |
| Navigation → cached source message |   44 |   54 |      32–54 |
| Main editor hydration / render     |  274 |  295 |    259–298 |
| Main-thread total blocking time    |  234 |  256 |    219–258 |
| Worker → main message transit      | 3.05 | 6.98 | 2.90–10.00 |

The browser showed the loading screen immediately, then reached the editable
`AHO · non` view without console-visible application errors. Warm runs show that
the SharedWorker cache removes almost all source delay; hydration becomes the
dominant remaining phase.

### Bundled production assets (cold confirmation, n = 1)

A separate Playwright capture used the built `dist` server on loopback. It is a
confirmation sample, not a latency distribution:

| Metric                          | Duration |
| ------------------------------- | -------: |
| Navigation → editor usable      |   13,585 |
| Bootstrap rendered              |       54 |
| Navigation → source message     |   13,212 |
| Manifest RPC                    |       90 |
| 206-unit RPC fan-out wall time  |   12,540 |
| Source directory assembly       |       17 |
| Worker validation / compilation |      481 |
| Main editor hydration / render  |      346 |
| Main-thread total blocking time |      313 |
| First paint / contentful paint  |  28 / 88 |

The production capture contained one 363 ms main-thread long task. Most
importantly, bundled assets did not change the attribution: source-unit RPC work
still consumed about 92% of time to editor usable.

### Direct source-service profile

The reproducible profiler ran directly against `fonts/workbench-sans`, outside
HTTP and the browser:

```sh
bun packages/create-font/scripts/profile-source-service.ts fonts/workbench-sans
```

It observed exactly 208 complete project loads: one during service
initialization, one for `readManifest()`, and 206 for the concurrently requested
`readUnit()` calls. The service lock serialized the unit calls.

| Direct service metric                   |           Result |
| --------------------------------------- | ---------------: |
| `readManifest()` wall time              |         67.98 ms |
| 206 `readUnit()` calls wall time        |     12,498.92 ms |
| Per-unit complete load total p50 / p95  | 59.81 / 66.09 ms |
| Path collection per load p50 / p95      |   2.32 / 3.40 ms |
| File realpath/read/hash/parse p50 / p95 | 43.98 / 50.32 ms |
| Full source assembly per load p50 / p95 | 12.65 / 15.36 ms |
| One bulk JSON payload encoding          |          2.17 ms |
| Bulk JSON payload size                  |    325,266 bytes |
| One manifest-style load + bulk encoding |         70.01 ms |

The per-load p50 spends about 74% in file resolution/read/hash/parse and 21% in
assembly. The unit fan-out alone performs 206 × 206 = 42,436 file reads/parses
and 206 assemblies. Including initialization and the manifest makes the complete
cold path 42,848 file reads/parses and 208 assemblies.

An independent lower-bound run called
`loadEditorFontSourceDirectory("./fonts/workbench-sans")` 12 times sequentially,
discarded two warmups (98.3 and 69.3 ms), and measured the remaining ten:
p50 63.52 ms, upper sample 67.44 ms, range 57.87–67.66 ms. Multiplying the p50 by
206 predicts 13.09 seconds, closely matching the browser's 12.70-second fan-out
p50 and the direct service's 12.50-second wall time.

## Attribution

The cold path is dominated by source-unit transport/server work, not source
assembly, validation, cross-thread cloning, assets, or main rendering:

1. `source-session.worker.ts` starts all 206 `GET /api/source/unit` calls with
   `Promise.all`, but their resource durations form a near-linear staircase and
   consume about 92% of cold p50 time.
2. `createFileSystemSourceService()` in
   `packages/create-font/src/source-service.ts` sends every `readUnit` through one
   `withLock` queue and calls `loadProject()` for that unit.
3. `loadProjectDirectory()` walks, reads, parses, and assembles the complete
   project. The initial browser load therefore performs a full 206-file project
   load once per requested unit, serially.

The measured behavior explains both the request waterfall and its roughly
60–70 ms increment per response. `Promise.all` in the worker cannot recover
parallelism across the service lock, and parallelism alone would still repeat
the full-project validation work.

This is an N+2 complete-load pattern over an N-file project, making initial
source work O(N²). The independent single-load timing accounts for essentially
the entire observed critical path, so the theory is falsifiable and already
cross-validated at browser, RPC-wall, and direct-service levels.

## Consistency audit

The current service has valuable correctness properties worth preserving:

- every individual manifest/unit read and write is serialized by `withLock` and
  returns data from a fully parsed and assembled project;
- writes reload disk state before checking revisions, validate the complete
  candidate, journal and atomically rename coordinated units, roll back failures,
  and reload the committed result;
- idempotency keys return the prior logical result or reject mismatched reuse;
  and
- watcher events debounce, enter the same lock, and publish only a successfully
  validated manifest.

The multi-request startup does not provide a coherent project snapshot,
however. A manifest may be read at revision A, an external edit may land, and
later unit requests may return revision B. The worker neither binds unit reads
to the inventory revision nor checks each returned unit revision against its
manifest descriptor, yet labels the assembled source with the inventory's
aggregate revision. A structurally valid mixed read can therefore be accepted
under the wrong revision.

Caching adds further invariants that the current fresh-read approach avoids:

- writes must force a disk refresh at their start so a debounced/missed watcher
  cannot permit an overwrite based on stale cached revisions;
- cached values need immutable nested `JsonValue` ownership, not only a readonly
  map type;
- watcher registration currently happens after the initial load, leaving a gap
  in which a future authoritative cache could miss an edit;
- the watcher list covers only directories present at startup, so nested
  directory creation/removal needs a reconciled directory→watcher map; and
- invalid external state needs explicit last-known-good/error semantics rather
  than silently advancing the published revision.

## Follow-up recommendations

1. **First optimization — high impact / high confidence / medium complexity:**
   add an atomic, bounded `SourceProjectSnapshot { revision, units[] }` read to
   the source service and RPC. One request calls `loadProjectDirectory()` once
   and derives the aggregate revision and every unit snapshot from that same
   `LoadedProject`. This preserves fresh-from-disk behavior, eliminates 206 HTTP
   requests and repeated loads, and removes the manifest/unit torn-read window
   without introducing authoritative cache invalidation.
2. **Phase two only if a single load remains material — medium incremental impact
   / medium confidence / high correctness complexity:** keep an immutable
   last-known-good `LoadedProject` pointer and atomically swap it only after full
   validation. Address forced write refresh, deep ownership, watcher-registration
   gaps, dynamic directory reconciliation, invalid-state reporting, and bounded
   reconciliation before making cached reads authoritative.
3. **Later incremental loading — potentially high large-font impact / medium
   complexity:** batch only changed/new paths, but bind the request to an expected
   aggregate revision. A stale revision is a normal retry when a newer watcher
   event supersedes an in-flight refresh. Reuse unchanged units only when their
   raw-text descriptor revisions match, and delete paths absent from the newer
   manifest.
4. **Secondary / medium impact / medium confidence:** profile the 274 ms warm p50
   hydration long task with a sampling trace after the source bottleneck is
   removed. It is material for warm navigation but only about 2% of the current
   cold path.
5. **Reject as a primary fix:** removing the service lock or merely increasing
   HTTP concurrency retains N complete project loads, increases I/O/CPU pressure,
   and weakens coherence. Combining canonical source into one file would conflict
   with the repository-oriented directory contract.
6. **Low priority now:** do not optimize the 16 ms assembly phase or 3 ms
   cross-thread transit based on this baseline.

### Falsifiable bulk-snapshot prediction

The direct profile measured one complete load plus encoding at 70 ms for a
325 KB body. Adding the existing browser phases gives a predicted cold floor of
roughly 1.0–1.2 seconds: about 70 ms server work/encoding + transport, 16 ms
browser assembly, 519 ms validation, 378 ms hydration, and small asset/transit
costs.

The theory predicts, for `workbench-sans` on this environment:

- one initial source HTTP request instead of manifest + 206 unit requests;
- one browser-triggered complete project load and O(N) file reads instead of
  N+1 loads and O(N²) reads;
- unit/snapshot RPC wall time below 250 ms; and
- cold editor-usable p50 below 1.5 seconds without a persistent cache.

Any of these failing falsifies part of the theory and should trigger another
profile before adding cache complexity. In particular, if a single project load
remains significant for a 1,000-unit stress corpus, then cache/incremental work
has measured justification.

### Correctness and regression test plan

For every exposed snapshot, tests must recompute the aggregate revision from the
ordered path/unit-revision pairs, verify each unit revision matches its returned
content, and successfully assemble all units. Add race coverage for:

- an external edit between legacy manifest and unit reads, and an edit during a
  bulk read;
- a newer source event arriving while an older refresh is in flight;
- rapid coalesced edits, invalid external state followed by repair, and revision
  monotonicity;
- nested directory add/delete/rename and watcher events without filenames;
- reads racing RPC writes, stale writes, transaction rollback, and idempotent
  retry; and
- old/new/deleted unit paths bound to an expected aggregate revision.

Benchmark 20-, 206-, and approximately 1,000-unit projects with ten cold and ten
warm dev and production runs. Assert one initial snapshot request and O(N) file
reads; use latency budgets as regression signals rather than timing assertions in
ordinary unit tests.

Re-run the same ten cold and warm samples after the source-service change. A
candidate regression budget for `workbench-sans` is cold p50 ≤ 2 seconds, cold
p95 ≤ 3 seconds, and warm p95 ≤ 500 ms. Treat these as provisional until the
same protocol is run against a documented larger font corpus and bundled
production assets.

## Limitations

- The bundled production result is one confirmation sample, not the ten-run
  p50/p95 distribution used for development mode.
- The repository has no checked-in stress corpus larger than `workbench-sans`,
  so the candidate budget is not yet a representative-font product SLO.
- The Playwright tool session did not expose its exact Chromium build string.
- Sampling flame charts were unavailable through the current browser-tool
  surface; correlated User Timing/resource/long-task observations were captured
  instead.
