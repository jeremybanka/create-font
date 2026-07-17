# Startup performance profiling

The browser application exposes a read-only diagnostic snapshot for measuring
the interval covered by the initial loading screen:

```ts
window.__CREATE_FONT_STARTUP_PROFILE__()
```

The snapshot correlates the browser main thread and source-session SharedWorker
with epoch-based time origins. It includes:

- navigation, paint, resource, long-task, and total-blocking-time observations;
- bootstrap render, source-message receipt, editor hydration/render, and the
  first double-animation-frame `editor-usable` milestone;
- SharedWorker module/connection/source-ready milestones;
- manifest RPC, parallel source-unit RPC, directory assembly, and validation /
  compilation phases;
- individual unit-request durations, RPC resource sizes when the browser exposes
  them, and cross-context message transit time; and
- a `cold-worker` / `warm-worker` classification. A SharedWorker can outlive a
  tab, so warm navigation is a distinct product scenario rather than a noisy
  cold run.

The instrumentation is observational. It does not add retries, caching, request
aggregation, or another startup strategy. Capture evidence before proposing an
optimization.

## Reproducible capture protocol

Record the commit, OS/hardware, Bun and browser versions, build mode, font
project, source-unit count, cache state, and whether DevTools was open.

For a development profile:

```sh
bun packages/create-font/src/font-cli.ts dev workbench-sans --root=. --port=4173
```

Use another unoccupied loopback port when 4173 is already in use. Open the URL
in a clean browser context and wait until the profile status is `editor-usable`:

```ts
await page.goto(`http://127.0.0.1:4173/`)
await page.waitForFunction(
	() => window.__CREATE_FONT_STARTUP_PROFILE__?.().status === `editor-usable`,
)
const profile = await page.evaluate(() =>
	window.__CREATE_FONT_STARTUP_PROFILE__(),
)
```

Save the complete JSON snapshot, not only `profile.summary`. Resource and
long-task entries are needed to explain the headline durations.

Profile the server-side source service separately from HTTP and browser work:

```sh
bun packages/create-font/scripts/profile-source-service.ts fonts/workbench-sans
```

This opt-in diagnostic records why each complete project load occurred and
splits it into path collection, file read/parse/hash, and source assembly. It
then simulates encoding one atomic bulk snapshot so repeated project loading can
be distinguished from JSON serialization and payload size. It does not change
the service's read, write, watcher, or caching behavior. Timing calls are skipped
unless an observer is supplied, and observer failures are isolated from source
loading.

- A **cold-worker run** starts in a new browser context, so no source-session
  SharedWorker or HTTP cache survives.
- A **warm-worker run** reloads or opens another tab in the same context after a
  successful cold run. Record HTTP cache state separately.
- Capture at least 10 runs of each primary scenario, report p50 and p95, and keep
  raw snapshots. A single trace is useful for call-stack attribution but is not
  a latency distribution.
- Profile both `font dev` and the built `dist/public` application. Report server
  process readiness separately: development worker bundling occurs before the
  browser loading screen and must not be charged to browser navigation.
- Keep `workbench-sans` as the checked-in comparison fixture, then repeat with a
  documented larger project. Always report source-unit count and source bytes.

For a sampling trace, start the browser performance trace before `page.goto`,
stop it only after `editor-usable`, and correlate the trace with the named
milestones. Instrumentation can perturb very short phases, so use phase marks for
boundaries and sampling stacks for attribution.

## Interpreting the report

`summary.workerSourceReady` is expressed relative to the page navigation time
origin. It may be negative in a warm-worker run because the shared source was
ready before the tab existed. `messageTransitDuration` is the epoch-correlated
gap from the worker posting the source snapshot to the main thread receiving it;
it includes scheduling and structured-clone transfer.

Main-thread total blocking time uses the standard long-task approximation: the
sum of each observed task's duration above 50 ms. Browsers without Long Tasks
API support return an empty list and zero; record that limitation rather than
treating zero as proof of no blocking.

Do not sum overlapping resource durations. For parallel source-unit requests,
the `source-unit-rpc-fanout` wall time is the relevant critical path; individual
durations identify stragglers.

## Baselines

- [Initial development baseline, 2026-07-17](./performance/startup-baseline-2026-07-17.md)
