# @create-design/png

## 0.1.3

### Patch Changes

- @create-design/source@0.4.3
  - @create-design/model@0.2.3
  - @create-design/svg@0.1.3

## 0.1.2

### Patch Changes

- @create-design/source@0.4.2
  - @create-design/model@0.2.2
  - @create-design/svg@0.1.2

## 0.1.1

### Patch Changes

- @create-design/source@0.4.1
  - @create-design/model@0.2.1
  - @create-design/svg@0.1.1

## 0.1.0

### Minor Changes

- db30f7b: Add the version-six first-class layer contract, migrate legacy singleton scenes,
  and preserve ordered layers throughout editing, SVG, and PNG projections.

### Patch Changes

- 27a2793: Add configurable transparent artboard backgrounds, outside borders, canvas labels, and active Artboards tile styling with consistent SVG, PNG, and PDF export behavior.
- 8a6aee9: Add deterministic PNG export, browser worker downloads and live preview, and CLI batch parity.
- 5c9197e: Preserve linked artboard paints, artboard backgrounds, live text and image resources, clipping, visibility and locking, and atomic selection across canvas and headless PDF, SVG, and PNG exports, with explicit diagnostics for unresolved and cyclic references.
- fa8a287: Share one effective layer projection across the canvas, previews, clipboard interchange, PDF, SVG, and PNG output.
- 3fb4abf: Preserve open create-design contours losslessly while deriving straight fill closure independently from open stroke topology, including Pathfinder and SVG/PDF/PNG output parity. Pen drafts now finish open on Enter, double-click, or a tool switch, retain same-frame Bézier handle drags when pointer capture ends before pointer-up reaches the canvas, and Direct Selection deletes nodes by splitting their surviving runs instead of deleting the complete object.
- Updated dependencies [3275452]
- Updated dependencies [1a9b87b]
- Updated dependencies [6421beb]
- Updated dependencies [48db2a7]
- Updated dependencies [e56860f]
- Updated dependencies [27a2793]
- Updated dependencies [c80b294]
- Updated dependencies [5c9197e]
- Updated dependencies [fa8a287]
- Updated dependencies [3d7e4d5]
- Updated dependencies [664804c]
- Updated dependencies [bbf22f4]
- Updated dependencies [62c9d01]
- Updated dependencies [3fb4abf]
- Updated dependencies [864121c]
- Updated dependencies [db30f7b]
- Updated dependencies [17f9651]
- Updated dependencies [f0710f5]
  - @create-design/model@0.2.0
  - @create-design/source@0.4.0
  - @create-design/svg@0.1.0
