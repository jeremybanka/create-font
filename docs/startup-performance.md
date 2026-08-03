# Startup performance profiling

The browser application exposes a read-only diagnostic snapshot for measuring
the interval covered by the initial loading screen:

```ts
window.__CREATE_FONT_STARTUP_PROFILE__()
```

The snapshot records the browser's direct server-backed startup path. It
includes:

- navigation, paint, resource, long-task, and total-blocking-time observations;
- bootstrap render, source-message receipt, editor hydration/render, and the
  first double-animation-frame `editor-usable` milestone;
- the atomic source-snapshot RPC phase; and
- RPC resource sizes when the browser exposes them.

The `session` field is `direct-server`. Historical captures may contain the
retired SharedWorker phases and `cold-worker` / `warm-worker` classifications.
The instrumentation is observational and does not add retries or caching.

## Reproducible capture protocol

Record the commit, OS/hardware, Node and browser versions, build mode, font
project, source-unit count, cache state, and whether DevTools was open. Record
the Bun version as well when measuring the optional Bun compatibility path.

For a development profile:

```sh
node apps/create-font/src/font-cli.ts dev workbench-sans --root=. --port=4173
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
node apps/create-font/scripts/profile-source-service.ts fonts/workbench-sans
```

This opt-in diagnostic records why each complete project load occurred and
splits it into path collection, file read/parse/hash, and source assembly. It
profiles the legacy manifest/unit fan-out and ten atomic bulk reads, then encodes
one bulk response so repeated project loading can be distinguished from JSON
serialization and payload size. It does not change the service's read, write,
watcher, or caching behavior. Timing calls are skipped unless an observer is
supplied, and observer failures are isolated from source loading.

- A **cold run** starts in a new browser context with an empty HTTP cache.
- A **warm run** reloads or opens another tab after a successful cold run.
  Record HTTP cache state separately.
- Capture at least 10 runs of each primary scenario, report p50 and p95, and
  keep raw snapshots. A single trace is useful for call-stack attribution but
  is not a latency distribution.
- Profile both `font dev` and the built `dist/public` application. Report server
  process readiness separately.
- Keep `workbench-sans` as the checked-in comparison fixture, then repeat with a
  documented larger project. Always report source-unit count and source bytes.

For a sampling trace, start the browser performance trace before `page.goto`,
stop it only after `editor-usable`, and correlate the trace with the named
milestones. Instrumentation can perturb very short phases, so use phase marks for
boundaries and sampling stacks for attribution.

## Interpreting the report

`summary.sourceSnapshotRpc` is the browser-observed wall time for the coherent
startup snapshot request.

Main-thread total blocking time uses the standard long-task approximation: the
sum of each observed task's duration above 50 ms. Browsers without Long Tasks
API support return an empty list and zero; record that limitation rather than
treating zero as proof of no blocking.

Do not sum overlapping resource durations. Current profiles use the
`source-snapshot-rpc` wall phase and should contain exactly one
`/api/source/snapshot` resource on a cold load. Legacy parallel-source-unit
profiles use `source-unit-rpc-fanout`; their individual durations identify
stragglers.

## Baselines

- [Initial development baseline, 2026-07-17](./performance/startup-baseline-2026-07-17.md)
