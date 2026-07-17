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

## Follow-up recommendations

1. **High impact / high confidence / medium complexity:** keep one immutable,
   validated `LoadedProject` snapshot in the filesystem source service. Serve
   the manifest and unit snapshots from that same revision, update it atomically
   after writes, and invalidate/reload it once after coalesced external watcher
   events. Preserve the existing lock for mutations, not repeated read-only
   whole-project loads. Add consistency tests for reads racing writes and watcher
   invalidation.
2. **Alternative or complementary / high confidence / medium complexity:** add a
   bounded source-snapshot RPC that returns the manifest and validated units in
   one response. This removes 206 HTTP round trips but should reuse the cached
   service snapshot rather than mask repeated disk validation behind one route.
3. **Secondary / medium impact / medium confidence:** profile the 274 ms warm p50
   hydration long task with a sampling trace after the source bottleneck is
   removed. It is material for warm navigation but only about 2% of the current
   cold path.
4. **Low priority now:** do not optimize the 16 ms assembly phase or 3 ms
   cross-thread transit based on this baseline.

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
