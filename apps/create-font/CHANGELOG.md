# create-font

## 0.3.17

### Patch Changes

- Updated dependencies [df5f8e6]
- Updated dependencies [27b8d85]
  - @create-font/editor@0.9.1
  - @create-font/states@0.7.0
  - @create-font/source@0.2.9

## 0.3.16

### Patch Changes

- a114bac: Load the shared tiling editor styles correctly during development.
- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.
- Updated dependencies [a731f3b]
  - @create-font/editor@0.9.0

## 0.3.15

### Patch Changes

- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- Updated dependencies [7205533]
- Updated dependencies [8188be2]
- Updated dependencies [7390b70]
- Updated dependencies [c852f02]
- Updated dependencies [efd3b76]
- Updated dependencies [dd3321b]
  - @create-font/editor@0.8.0
  - @create-font/fea-rs-wasm@0.1.2
  - @create-art/source-format@0.1.2
  - @create-art/source-rpc@0.1.2
  - @create-font/server@0.2.3
  - @create-font/source@0.2.8
  - @create-font/states@0.6.8
  - @create-font/target@0.0.3

## 0.3.14

### Patch Changes

- 2b737a0: Expose a product-neutral source review surface with semantic row, navigation adapter, comparison, and guarded selective-commit hooks while preserving create-font glyph review and Diff View.

  Initialize create-font source review in an actionable empty state so the first
  HEAD-to-working comparison can be requested.

- 0d59cb3: Format canonical create-font and create-design source with the pinned,
  published dprint contract before hashing and persistence, and expose matching
  `create-source-format` fmt/check workflows for users, editors, and CI.
- 05f8226: Generalize bounded source comparison and selective Git commits with adapter-defined semantic change groups, and enable design-aware version control.
- 76d6aa0: Add shared revisioned source RPC infrastructure and source-backed create-design workspaces with atomic persistence and reliable live editor synchronization, including active glyph restoration after external filesystem resets. Run both editors and their APIs from the root development command on a configurable four-port block, with the checked-in Workbench Poster as create-design's default development source.
- Updated dependencies [c5b4ace]
- Updated dependencies [2b737a0]
- Updated dependencies [0d59cb3]
- Updated dependencies [05f8226]
- Updated dependencies [05f8226]
- Updated dependencies [76d6aa0]
- Updated dependencies [9e5ee6c]
  - @create-font/states@0.6.7
  - @create-font/editor@0.7.10
  - @create-font/source@0.2.7
  - @create-art/source-format@0.1.1
  - @create-art/source-rpc@0.1.1
  - @create-font/server@0.2.2

## 0.3.13

### Patch Changes

- aa926b7: Add shared Adobe feature analysis, checking CLI, language server, and bundled VS Code extension
- 1856b23: Replace the transitional TypeScript Adobe feature parser with upstream fea-rs through shared WebAssembly bindings in Node and browser consumers.
- 13eda7d: Add shared authoritative vector gesture state machines and interactive scene components for font and design editing, including complete Pen drafts, Bézier handles, cancellation, shape placement, selection, and coordinate-correct transforms in both y-up and y-down canvases. Keep create-design persistence and history in its document adapter while deferring its Rule tool, and preserve create-font's responsive native Pen transactions and unselected preview marker. Add an issue-linked create-font tool itinerary, mounted interaction-lifecycle regressions, and CI-enforced Vitest coverage floors for the font-tool surface. Keep Pen commits responsive by using shallow revision dependencies for mounted font projections, compiling live fonts only while a Preview tile is present, coalescing whole-source persistence after an edit burst, and moving post-save full-font validation into an incremental source worker so edits do not block the renderer. Restore Shift-marquee selection inversion so every covered node or handle toggles its prior selection state, fully select pasted contours including their authored handles, and keep selected-contour fills, outlines, nodes, and screen-constant selection rings aligned with the pointer while controlled Konva nodes rerender. Let the full-width invisible edge hit target initiate the same selected-contour drag as the visible stroke.
- Updated dependencies [aa926b7]
- Updated dependencies [38e7d82]
- Updated dependencies [1856b23]
- Updated dependencies [1856b23]
- Updated dependencies [e354211]
- Updated dependencies [13eda7d]
- Updated dependencies [216946d]
  - @create-font/source@0.2.6
  - @create-font/editor@0.7.9
  - @create-font/fea-rs-wasm@0.1.1
  - @create-font/states@0.6.6

## 0.3.12

### Patch Changes

- fbd5a2f: Run the workspace HTTP and WebSocket server under Node with Elysia's native runtime adapters.
- fbd5a2f: Remove Bun-specific globals from installed runtime code and add an explicit package-manager and process adapter boundary.
- ccd346e: Build and test the browser and server workflow with Node while retaining Bun runtime compatibility.
- Updated dependencies [fbd5a2f]
- Updated dependencies [ccd346e]
  - @create-font/server@0.2.1
  - @create-font/editor@0.7.8
  - @create-font/states@0.6.5
  - @create-font/source@0.2.5

## 0.3.11

### Patch Changes

- 475f2f7: Replace SharedWorker source coordination with server-authoritative ordered unit deltas, direct revision-guarded writes, snapshot recovery, and faster dirty-edit persistence.
- Updated dependencies [475f2f7]
  - @create-font/editor@0.7.7
  - @create-font/server@0.2.0
  - @create-font/states@0.6.4
  - @create-font/source@0.2.4

## 0.3.10

### Patch Changes

- Updated dependencies [6601452]
- Updated dependencies [e610e37]
- Updated dependencies [1f74d99]
  - @create-font/editor@0.7.6
  - @create-font/states@0.6.3
  - @create-font/source@0.2.3

## 0.3.9

### Patch Changes

- Updated dependencies [9ed0716]
  - @create-font/editor@0.7.5

## 0.3.8

### Patch Changes

- 04000ab: Compile Adobe feature sources into GSUB tables and apply enabled substitutions in the Canvas preview.
- Updated dependencies [0874e0d]
- Updated dependencies [7d0b55c]
- Updated dependencies [5ff7ace]
- Updated dependencies [f87a70c]
- Updated dependencies [04000ab]
- Updated dependencies [eed4136]
  - @create-font/editor@0.7.4
  - @create-font/target@0.0.2
  - @create-font/states@0.6.2
  - @create-font/source@0.2.2

## 0.3.7

### Patch Changes

- ae3d43e: Prevent loading-screen layout shift and remove obsolete diff overlays that collided with tile management controls.
- Updated dependencies [c3ababf]
- Updated dependencies [6670af3]
- Updated dependencies [07221ff]
- Updated dependencies [c28c938]
- Updated dependencies [ae3d43e]
  - @create-font/editor@0.7.3

## 0.3.6

### Patch Changes

- ed751e8: Add bounded Git snapshot comparison, visual diff review, and guided selective commits.
- Updated dependencies [ed751e8]
  - @create-font/editor@0.7.2
  - @create-font/server@0.1.1
  - @create-font/states@0.6.1
  - @create-font/source@0.2.1

## 0.3.5

### Patch Changes

- Updated dependencies [9cc75e0]
- Updated dependencies [613f9fb]
- Updated dependencies [dde1031]
  - @create-font/editor@0.7.1

## 0.3.4

### Patch Changes

- Updated dependencies [61e9d52]
- Updated dependencies [61e9d52]
- Updated dependencies [4f41584]
- Updated dependencies [8a36d1f]
  - @create-font/editor@0.7.0

## 0.3.3

### Patch Changes

- 9f0fe7d: Store outlines independently per master, migrate v3/v4 shared topology to the
  v5 source model, validate interpolation compatibility explicitly, preserve
  authored paths during export, and add master comparison plus path-order tools.
- Updated dependencies [9f0fe7d]
  - @create-font/states@0.6.0
  - @create-font/source@0.2.0
  - @create-font/editor@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [b64038b]
- Updated dependencies [80bcc77]
- Updated dependencies [d946e2e]
- Updated dependencies [829bcd6]
- Updated dependencies [a325bed]
- Updated dependencies [2a2f1eb]
- Updated dependencies [7dfefd2]
- Updated dependencies [53cfdff]
- Updated dependencies [716ccd1]
- Updated dependencies [abbaed8]
- Updated dependencies [585a2af]
  - @create-font/editor@0.5.0
  - @create-font/states@0.5.0
  - @create-font/source@0.1.4

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
