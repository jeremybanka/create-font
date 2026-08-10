# create-sprites product research

Research was completed before the editor architecture was set. The goal was to
identify the conventions users already rely on in sprite tools, then express
those conventions through the create-art workspace and source model rather than
copying another product's chrome.

## Reference products

- [Aseprite basics](https://www.aseprite.org/docs/basics/) establishes the core
  frame × layer = cel model and treats the timeline as the primary animation
  surface.
- [Aseprite drawing](https://www.aseprite.org/docs/drawing/) prioritizes pencil,
  eraser, fill, line, rectangle, eyedropper, zoom, and symmetry as the daily
  pixel workflow.
- [Aseprite color modes](https://www.aseprite.org/docs/color-mode/) shows why
  indexed color is valuable: editing one palette entry updates every pixel that
  references it.
- [Aseprite exporting](https://www.aseprite.org/docs/exporting) and its
  [sprite-sheet CLI](https://www.aseprite.org/docs/cli/) make the production
  boundary clear: editable project source stays rich, while games consume PNG
  frames/sheets and machine-readable frame metadata.
- [Piskel](https://www.piskelapp.com/) demonstrates the value of continuous live
  animation preview in a browser-native editor.
- [Pixelorama](https://orama-interactive.itch.io/pixelorama) reinforces onion
  skins, frame tags, palette management, perfect-pixel algorithms, tile-aware
  workflows, automatic recovery, and multiple export paths as the expected
  modern feature set.

## Product decisions

| Convention | create-sprites expression |
| --- | --- |
| Frame/layer cel matrix | Persistent bottom timeline with selectable cel intersections |
| Pixel-first tools | Six integer-coordinate tools with gap-free lines and 1–8 px brushes |
| Foreground/background paint | Primary and secondary indexed colors mapped to left/right pointer buttons |
| Animation context | Onion skins on the canvas and a live timed preview tile |
| Indexed palette | Up to 64 stable palette entries; cels store readable palette symbols |
| Source vs. output | Split, versioned JSON project source; PNG/sheet/JSON are explicit exports |
| Production metadata | Per-frame rectangles and durations plus authored animation tags |
| Safety | Atomic source writes, browser recovery copy, autosave, and immutable undo history |
| Workspace flexibility | Shared create-art four-lane tiling, responsive allocation, and accessible controls |

## Deliberate first-release boundary

The complete first release focuses on sprite drawing and frame animation. It
does not attempt tilemap authoring, audio synchronization, extension scripting,
or proprietary `.aseprite` file compatibility. The durable source format keeps
stable identities for those future additions without making the initial editor
depend on speculative features.
