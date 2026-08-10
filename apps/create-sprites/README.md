# create-sprites

`create-sprites` is the source-first pixel art and frame animation application
in the create-art family. It combines an indexed-color pixel canvas, layer/cel
timeline, onion skinning, live playback, palette editing, lossless undo, PNG
import, and game-ready sprite-sheet export in the same rearrangeable tiled
workspace used by create-font and create-design.

## CLI workflow

Create a sprite source project:

```sh
create-sprites sprites/hero --title "Hero run" --width 32 --height 32
```

Build the package and open a project with the production-shaped editor server:

```sh
pnpm --filter create-sprites build
sprites sprites/hero
```

During workspace development, `pnpm dev:sprites` opens the checked-in
`sprites/ember-scout` project. The root `pnpm dev` command starts create-font,
create-design, and create-sprites together.

## Source format

The browser never owns the canonical project. It edits a versioned directory
contract through the project server:

```text
sprite-project/
├── create-sprites.json
├── document.json
├── palette.json
├── layers/index.json
├── frames/index.json
├── tags/index.json
└── cels/<frame-id>/<layer-id>.json
```

Cels are reviewable indexed rows: one palette symbol per pixel and `.` for
transparency. A project may contain up to 64 authored colors. Layer, frame,
palette, tag, and cel identities remain stable across edits; saves publish every
source file atomically.

## Editor workflow

- Pencil (`B`), Eraser (`E`), Fill (`G`), Line (`L`), Rectangle (`U`), and
  Eyedropper (`I`) work directly in integer pixel coordinates.
- Left and right pointer buttons use the primary and secondary palette colors.
- Horizontal and vertical symmetry, 1–8 pixel brushes, adjustable onion skins,
  and 2×–32× zoom support common pixel-art workflows.
- The persistent timeline exposes the frame/layer cel matrix while Live Preview
  plays authored per-frame durations.
- Export produces a scaled current-frame PNG, a sprite-sheet PNG with matching
  frame/tag JSON, or a portable complete project JSON.
- PNG import uses nearest-neighbor sizing and maps pixels to the current indexed
  palette, keeping the source contract deterministic.

The browser maintains a local recovery copy even when no source server is
available. With the CLI server connected, source edits autosave after a short
idle period and can also be committed immediately with `Ctrl`/`Cmd` + `S`.

## Shared foundations

The application imports `@create-art/editor` for the responsive tiling system
and accessible tile controls. It deliberately keeps its raster document model,
pixel algorithms, filesystem source contract, and browser canvas implementation
inside `create-sprites`; no existing create-font, create-design, or create-art
package is modified to add product-specific behavior.
