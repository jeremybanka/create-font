# @create-font/server

## 0.1.0

### Minor Changes

- f51bcf5: Add the revision-consistent `SourceProjectSnapshot` service contract and version
  4 bulk snapshot RPC. Switch the editor SharedWorker to load and refresh every
  validated source unit through one atomic snapshot request while preserving the
  legacy manifest and individual-unit endpoints.

  Add correlated browser, SharedWorker, and filesystem source-service startup
  instrumentation, a reproducible profiling workflow, and measured development
  and production baselines.

## 0.0.1

### Patch Changes

- 84cccb3: Serialize validated target-v1 fonts and make `font build` emit deterministic,
  atomic variable TrueType artifacts with structured diagnostics.
