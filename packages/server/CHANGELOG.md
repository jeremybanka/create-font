# @create-font/server

## 0.2.0

### Minor Changes

- 475f2f7: Replace SharedWorker source coordination with server-authoritative ordered unit deltas, direct revision-guarded writes, snapshot recovery, and faster dirty-edit persistence.

## 0.1.1

### Patch Changes

- ed751e8: Add bounded Git snapshot comparison, visual diff review, and guided selective commits.

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
