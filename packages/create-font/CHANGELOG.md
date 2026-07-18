# create-font

## 0.3.1

### Patch Changes

- 4365720: Publish the editor as a standalone browser artifact and load it from create-font's production dependency instead of embedding it in the CLI bundle.
- Updated dependencies [adb48ef]
- Updated dependencies [4365720]
- Updated dependencies [b4028b3]
- Updated dependencies [7c44ab6]
- Updated dependencies [d2446a5]
- Updated dependencies [6f81421]
  - @create-font/editor@0.4.0
  - @create-font/states@0.4.0
  - @create-font/source@0.1.3

## 0.3.0

### Minor Changes

- f51bcf5: Add the revision-consistent `SourceProjectSnapshot` service contract and version
  4 bulk snapshot RPC. Switch the editor SharedWorker to load and refresh every
  validated source unit through one atomic snapshot request while preserving the
  legacy manifest and individual-unit endpoints.

  Add correlated browser, SharedWorker, and filesystem source-service startup
  instrumentation, a reproducible profiling workflow, and measured development
  and production baselines.

### Patch Changes

- Updated dependencies [f51bcf5]
- Updated dependencies [0de6bd8]
  - @create-font/server@0.1.0
  - @create-font/states@0.3.0
  - @create-font/source@0.1.2

## 0.2.1

### Patch Changes

- 84cccb3: Serialize validated target-v1 fonts and make `font build` emit deterministic,
  atomic variable TrueType artifacts with structured diagnostics.
- Updated dependencies [4541636]
- Updated dependencies [4541636]
- Updated dependencies [4541636]
- Updated dependencies [84cccb3]
  - @create-font/states@0.2.0
  - @create-font/server@0.0.1
  - @create-font/target@0.0.1
  - @create-font/source@0.1.1

## 0.2.0

### Minor Changes

- 2abe981: Add the polished source bootstrap, dynamic document title and font favicon,
  shortcut tooltips, SharedWorker validation, and entity-scoped editor rendering
  needed for responsive multi-tab editing and fast timeline actions.

### Patch Changes

- Updated dependencies [2abe981]
- Updated dependencies [2abe981]
  - @create-font/states@0.1.0
  - @create-font/source@0.1.0

## 0.1.0

### Minor Changes

- 9f40a1d: Add separate `create-font` workspace initialization and repository-local `font`
  development entrypoints.
