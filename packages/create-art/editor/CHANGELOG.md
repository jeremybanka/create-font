# @create-art/editor

## 0.2.1

### Patch Changes

- 3fb4abf: Render exact Bézier geometry for create-design Pen previews and indicate snapped draft closure.
- cd55b47: Include the shared editor component styles in the create-font CLI browser stylesheet.
- 1a9b87b: Add authored layer UI colors, layer-colored selection outlines and fills, and a neutral layer-agnostic selection marquee.
- de6ecbb: Add orthogonal handles to the design transform overlay, including proportional Shift-resizing from side handles
- cbbd99d: Add explicit alignment key-object selection chrome and layer-colored square contour-node markers while preserving shared editor control defaults.
- bd5d86f: Quantize unit-based number input stepping and use the shared accessible button treatment for source comparison.
- 6421beb: Add placed raster images and editable clipping masks across source projects, canvas rendering, and PDF/SVG export.
- e56860f: Add durable circular and squircle corner profiles with shared inset controls,
  deterministic lowering, safe adjacent-corner clamping, accessible numeric
  editing, undoable multi-master font edits, and output/compiler parity.
- 3fb4abf: Finish open Pen drafts on Escape and paint in-progress contours with their authored appearance plus a layer-colored editing outline and hanging segment.
- 7c9c382: Add an Alt/Option alternate hotbar and keep keyboard-selected command and tile options visible.
- 207c441: Share accessible rich tooltips and make the create-design Tools tile a compact icon palette with distinct Direct Selection and Artboard shortcuts.
- 00c892a: Keep create-design selection and artboard outlines at one screen pixel while rendering selection above authored object strokes.
- 8818c4f: Share curvature-comb geometry and compact controls, then add selected-object comb diagnostics to create-design with object fill-topology-aware exterior normals.
- bd38221: Redesign export and source review tiles with responsive, accessible workflow controls
- 653eb46: Persist versioned named UI layouts from grouped home and project ui.json sources through the tile-management HUD in create-font and create-design, including supported locations reached through filesystem symlinks.
- 7c9c382: Share the configurable action hotbar with Create Design while preserving Create Font behavior.
- 46d635f: Add independent Bézier handle editing and fixed-handle node movement to create-design
- 85b9bb9: Add a persistent canvas Dimmer and consistent modifier stepping for mixed-capable stroke fields.
- Updated dependencies [e56860f]
- Updated dependencies [8818c4f]
- Updated dependencies [653eb46]
- Updated dependencies [f99d64d]
  - @create-art/vector-geometry@0.0.3
  - @create-art/ui-layout@0.1.1

## 0.2.0

### Minor Changes

- a731f3b: Port the browser editors from Preact and the local Konva adapter to React 19 and react-konva.

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
- Updated dependencies [c852f02]
  - @create-art/preact-konva@0.2.0
