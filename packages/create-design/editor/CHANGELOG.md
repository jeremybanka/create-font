# @create-design/editor

## 0.3.2

### Patch Changes

- @create-design/source@0.4.2
  - @create-design/model@0.2.2
  - @create-design/pdf@0.1.4
  - @create-design/png@0.1.2
  - @create-design/svg@0.1.2
  - @create-design/text@0.0.3

## 0.3.1

### Patch Changes

- @create-design/source@0.4.1
  - @create-design/model@0.2.1
  - @create-design/pdf@0.1.3
  - @create-design/png@0.1.1
  - @create-design/svg@0.1.1
  - @create-design/text@0.0.2

## 0.3.0

### Minor Changes

- 62c9d01: Add arbitrary-angle snapping guides and the two-point Guide tool.
- db30f7b: Add the version-six first-class layer contract, migrate legacy singleton scenes,
  and preserve ordered layers throughout editing, SVG, and PNG projections.

### Patch Changes

- 3fb4abf: Render exact Bézier geometry for create-design Pen previews and indicate snapped draft closure.
- 2309f2e: Improve create-design layer, guide, lock, and Direct Selection controls
- 3275452: Add editable point and area text, canonical font shaping and outline projection,
  persistent source fonts, PDF text lowering, overset diagnostics, and undoable
  text expansion. Use ready browser faces in the native editing overlay and exact
  layout/ink bounds for text selection, transforms, whitespace hit testing, and
  dragging. Rehydrate installed font bytes before reload preflight, reject stale
  browser font loads, and let whitespace double-clicks enter text editing.
  Keep canonical glyph outlines visually authoritative while the accessible native
  surface owns caret, selection, composition, and input. Store authored text in
  stable adjacent raw UTF-8 `.txt` units with lossless inline-source migration and
  coherent source/version-control transactions.
  Absorb proportional Point and Area Text resizing into canonical typography and
  frame metrics, including mixed selections and repeated transforms, while
  preserving anchored world geometry. Keep the native editor's content width
  independent of its border and prevent Point Text from soft-wrapping so caret and
  selection insertion boundaries remain aligned with shaped glyph advances.

  Keep installed font inventories and binary files coherent across comparison and
  selective version-control commits.
- 1a9b87b: Add authored layer UI colors, layer-colored selection outlines and fills, and a neutral layer-agnostic selection marquee.
- de6ecbb: Add orthogonal handles to the design transform overlay, including proportional Shift-resizing from side handles
- cbbd99d: Add explicit alignment key-object selection chrome and layer-colored square contour-node markers while preserving shared editor control defaults.
- 6421beb: Add placed raster images and editable clipping masks across source projects, canvas rendering, and PDF/SVG export.
- 48db2a7: Add a canonical create-design logo and demonstrate portable live artboard links by placing it in the Workbench Poster sample. Make live links discoverable in the Layers and Object tiles, treat their artboard bounds as a single snapping object, and carry placement scale into stroke widths and dash metrics.
- e56860f: Add durable circular and squircle corner profiles with shared inset controls,
  deterministic lowering, safe adjacent-corner clamping, accessible numeric
  editing, undoable multi-master font edits, and output/compiler parity.
- 27a2793: Add configurable transparent artboard backgrounds, outside borders, canvas labels, and active Artboards tile styling with consistent SVG, PNG, and PDF export behavior.
- 3fb4abf: Finish open Pen drafts on Escape and paint in-progress contours with their authored appearance plus a layer-colored editing outline and hanging segment.
- 8a6aee9: Add deterministic PNG export, browser worker downloads and live preview, and CLI batch parity.
- c80b294: Project layer visibility and locking through canvas interaction, selection, editing, snapping, and scoped SVG import without rewriting descendant object flags.
- 7c9c382: Add an Alt/Option alternate hotbar and keep keyboard-selected command and tile options visible.
- 1b2118e: Add Alt/Option-drag copying for object selections.
- 14b1e64: Add platform-standard keyboard shortcuts for changing selected artwork stacking order.
- b477f39: Snap Pen, Rectangle, Ellipse, and Artboard creation points to canvas targets with live hints.
- 207c441: Share accessible rich tooltips and make the create-design Tools tile a compact icon palette with distinct Direct Selection and Artboard shortcuts.
- 6376ef1: Finish first-class layers with hierarchy reparenting, stable source synchronization, semantic review, and a representative multi-layer fixture.
- 00c892a: Keep create-design selection and artboard outlines at one screen pixel while rendering selection above authored object strokes.
- 5c9197e: Preserve linked artboard paints, artboard backgrounds, live text and image resources, clipping, visibility and locking, and atomic selection across canvas and headless PDF, SVG, and PNG exports, with explicit diagnostics for unresolved and cyclic references.
- e2a54d3: Commit canvas gestures before releasing pointer capture, preserve cancellation, and use the final raw release coordinates.
- 8818c4f: Share curvature-comb geometry and compact controls, then add selected-object comb diagnostics to create-design with object fill-topology-aware exterior normals.
- fa8a287: Share one effective layer projection across the canvas, previews, clipboard interchange, PDF, SVG, and PNG output.
- b09bcd4: Add atomic layer creation, naming, duplication, deletion, ordering, visibility, and locking controls to the hierarchical Layers tile.
- 85e4b7a: Render the Layers tile as an accessible document, layer, group, and object tree with disclosure, scope breadcrumbs, effective-state labels, and keyboard navigation.
- 3d7e4d5: Add persisted live contour blends with deterministic interpolation, diagnostics, canvas rendering, clipboard semantics, and PDF lowering.
- 664804c: Add the complete user-facing live blend workflow, including creation, selection, correspondence editing, expansion, clipboard integration, diagnostics, and undoable controls.
- bd38221: Redesign export and source review tiles with responsive, accessible workflow controls
- bbf22f4: Add workspace design switching and versioned portable live linked-artboard objects, including browser canvas/export projection and isolated recovery state.
- 653eb46: Persist versioned named UI layouts from grouped home and project ui.json sources through the tile-management HUD in create-font and create-design, including supported locations reached through filesystem symlinks.
- 3fb4abf: Preserve open create-design contours losslessly while deriving straight fill closure independently from open stroke topology, including Pathfinder and SVG/PDF/PNG output parity. Pen drafts now finish open on Enter, double-click, or a tool switch, retain same-frame Bézier handle drags when pointer capture ends before pointer-up reaches the canvas, and Direct Selection deletes nodes by splitting their surviving runs instead of deleting the complete object.
- 7c9c382: Share the configurable action hotbar with Create Design while preserving Create Font behavior.
- 46d635f: Add independent Bézier handle editing and fixed-handle node movement to create-design
- 4da41fb: Add a Perspective Transform tool with snapping, constrained and center-origin cage gestures, and safe vector-path baking.
- be88c18: Make hierarchy operations layer-aware and insert new or pasted objects into the active layer or group scope.
- 6a40a28: Add fill/stroke keyboard shortcuts and safe object Cut clipboard support.
- 864121c: Clarify the target layer, paste ordinary and live artwork into that hierarchy scope, and make locked artwork transparent to canvas hit-testing.
- e166e2c: Add a Knife tool and Alt/Option edge conversion for exact, topology-safe path editing.
- 17f9651: Add deterministic SVG import, artboard export, browser download and live preview, and CLI parity with structured unsupported-content diagnostics.
- f0710f5: Move live-corner controls into the Object panel, expose object-wide corner
  handles in Select mode, make handle dragging directional, and let Expand Shape
  materialize live corners as ordinary editable cubic geometry. Keep live corner
  profiles isotropic through non-uniform object transforms, and quietly disclose
  when a contour temporarily limits their intended size.
- 85b9bb9: Add a persistent canvas Dimmer and consistent modifier stepping for mixed-capable stroke fields.
- 884a88e: Expose the remaining Create Design workspace actions through the command palette.
- Updated dependencies [3fb4abf]
- Updated dependencies [3275452]
- Updated dependencies [cd55b47]
- Updated dependencies [1a9b87b]
- Updated dependencies [de6ecbb]
- Updated dependencies [cbbd99d]
- Updated dependencies [bd5d86f]
- Updated dependencies [6421beb]
- Updated dependencies [48db2a7]
- Updated dependencies [e56860f]
- Updated dependencies [27a2793]
- Updated dependencies [3fb4abf]
- Updated dependencies [8a6aee9]
- Updated dependencies [c80b294]
- Updated dependencies [7c9c382]
- Updated dependencies [207c441]
- Updated dependencies [bbf22f4]
- Updated dependencies [00c892a]
- Updated dependencies [5c9197e]
- Updated dependencies [8818c4f]
- Updated dependencies [fa8a287]
- Updated dependencies [3d7e4d5]
- Updated dependencies [664804c]
- Updated dependencies [bd38221]
- Updated dependencies [bbf22f4]
- Updated dependencies [653eb46]
- Updated dependencies [62c9d01]
- Updated dependencies [3fb4abf]
- Updated dependencies [7c9c382]
- Updated dependencies [46d635f]
- Updated dependencies [f99d64d]
- Updated dependencies [864121c]
- Updated dependencies [db30f7b]
- Updated dependencies [17f9651]
- Updated dependencies [f0710f5]
- Updated dependencies [85b9bb9]
  - @create-art/editor@0.2.1
  - @create-art/source-rpc@0.1.3
  - @create-design/model@0.2.0
  - @create-design/pdf@0.1.2
  - @create-design/source@0.4.0
  - @create-design/svg@0.1.0
  - @create-design/text@0.0.1
  - @create-art/vector-geometry@0.0.3
  - @create-design/png@0.1.0

## 0.2.1

### Patch Changes

- 0e55ec6: Normalize design documents into granular atom.io atoms and keyed families.
- 3a29372: Restore composed geometry selectors with atom.io 0.51.1 transaction tracing.
- 9449dda: Use atom.io timeline effects to retain the latest 100 complete design undo steps.

## 0.2.0

### Minor Changes

- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.

### Patch Changes

- 8935808: Migrate document history and source persistence to isolated atom.io state.
- Updated dependencies [a731f3b]
  - @create-art/editor@0.2.0

## 0.1.1

### Patch Changes

- 8188be2: Separate the create-design browser editor from its CLI and server package,
  move shared editor foundations under create-art ownership, and make font-owned
  package directories explicit throughout the workspace. Move the product-neutral
  Preact Konva bindings into the product-neutral `@create-art` scope. Put
  canonical document initialization in the source package and extract headless
  design-model and PDF packages for browser and CLI consumers. Keep the
  fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
- Updated dependencies [8188be2]
- Updated dependencies [a5c4e14]
- Updated dependencies [8ed890a]
- Updated dependencies [c852f02]
- Updated dependencies [16e86cb]
- Updated dependencies [151d54a]
- Updated dependencies [3cbad6c]
- Updated dependencies [efd3b76]
- Updated dependencies [7471aca]
- Updated dependencies [306063e]
- Updated dependencies [7471aca]
- Updated dependencies [dd3321b]
- Updated dependencies [41e85b8]
  - @create-art/editor@0.1.1
  - @create-art/preact-konva@0.2.0
  - @create-design/model@0.1.1
  - @create-design/pdf@0.1.1
  - @create-design/source@0.3.0
  - @create-art/vector-geometry@0.0.2
  - @create-art/source-rpc@0.1.2
