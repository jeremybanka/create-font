# `@create-design/ai`

Headless Adobe Illustrator interchange for create-design. The importer reads the
visible PDF-compatible representation embedded in modern `.ai` files and lowers
supported vector artwork into a validated native `DesignDocument`.

```ts
import { readFile } from "node:fs/promises"
import { importAdobeIllustrator } from "@create-design/ai"

const imported = importAdobeIllustrator(await readFile("poster.ai"))
if (!imported.ok) console.error(imported.diagnostics)
else console.log(imported.document)
```

## Fidelity boundary

This is a visible-artwork interchange boundary, not a decoder for Illustrator's
private editing data. Each ordered PDF page becomes a create-design artboard.
The art box is used when present, then the crop box or media box. Pages are laid
out left-to-right with a 48-point gap because the PDF page tree does not retain
Illustrator's global artboard positions. Page and Form transforms are composed
with an explicit PDF Y-up to create-design Y-down transform.

| PDF-compatible Illustrator feature                                   | Import behavior                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Lines, cubic paths, rectangles, compound paths                       | Editable native paths                                                                                                           |
| Nonzero/even-odd fill rules                                          | Preserved                                                                                                                       |
| RGB, CMYK, and gray process paint                                    | Shared native swatches                                                                                                          |
| Width, cap, join, miter, and dash stroke style                       | Preserved                                                                                                                       |
| Graphics-state transforms, page rotation/UserUnit, and Form XObjects | Composed into object transforms; Form BBox clipping is preserved                                                                |
| Clipping paths                                                       | Preserved as nested native clipping groups, including intersecting clips                                                        |
| PDF optional-content groups                                          | Best-effort ordered native layers, including default visibility; private Illustrator hierarchy and object names are unavailable |
| Text and fonts                                                       | Skipped with a warning; outline text in Illustrator first                                                                       |
| Raster images                                                        | Skipped with a warning                                                                                                          |
| Gradients, patterns, spot/DeviceN/ICC colors                         | Skipped or retain a preceding process paint, with a warning                                                                     |
| Opacity, masks, and non-normal blend modes                           | Not represented; warned                                                                                                         |
| Illustrator effects, symbols, brushes, appearance stacks             | Only their visible PDF vector expansion can import                                                                              |

The importer accepts PDF 1.0–1.7 AI documents with direct objects and direct
stream lengths. Streams may be uncompressed or use `FlateDecode`. Legacy
PostScript-only AI, ordinary PDFs, encrypted PDFs, compressed object/xref
streams, indirect stream lengths, and unsupported content filters fail with an
actionable diagnostic before a document is returned. Bounded file, object,
page, stream, aggregate decoded/token work, path-point, emitted-document,
metadata, layer, and Form-recursion limits protect CLI imports from untrusted
or accidentally enormous files. The CLI checks and performs a bounded read of
the input before parsing.

## Development sample smoke test

The untracked reference files supplied with issue 479 were exercised without
being added to the repository. As of this implementation, `biome.ai` imports 8
artboards, 47 painted objects, and 18 swatches; `equip.ai` imports 1 artboard,
22 painted objects, 3 swatches, and its 5 optional-content names; and
`lasertag.ai` imports 4 PDF pages, 76 painted objects, and 1 process swatch while
reporting its ICC-color and live-text fidelity warnings. Small generated test
fixtures cover the same parser paths in the committed suite.
