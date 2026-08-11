# `@create-font/glyphs-app`

Headless Glyphs.app source support for create-font. The package parses editable
Glyphs 2 and 3 text files into a source-format AST, then explicitly lowers that
AST into a validated native create-font project.

```ts
import { readFile } from "node:fs/promises"
import { importGlyphsSource } from "@create-font/glyphs-app"
import { parseGlyphsSource } from "@create-font/glyphs-app/parser"

const text = await readFile("MyFont.glyphs", "utf8")
const parsed = parseGlyphsSource(text)
if (!parsed.ok) console.error(parsed.errors)
else console.log(parsed.value.root)

const imported = importGlyphsSource(text)
if (!imported.ok) console.error(imported.errors)
else console.log(imported.value.source)
```

## Architecture

- `parseGlyphsSource` parses the bounded OpenStep property-list dialect used by
  Glyphs, validates its declared format version, and retains the complete
  dictionary—including unknown and version-specific properties—alongside the
  original source text. The `@create-font/glyphs-app/parser` subpath is
  independent of create-font lowering at runtime.
- `lowerGlyphsSource` translates a parsed Glyphs document into create-font's
  editor model. Component expansion, axes, instances, cmap, metrics, kerning,
  feature validation, fidelity warnings, and native-source validation belong to
  this stage.
- `importGlyphsSource` composes parsing and lowering for CLI consumers.

The lowering boundary is explicit about what editor v5 can represent:

| Glyphs data                                                                                              | Import behavior                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| family/version, UPM, master metrics and style                                                            | default-master values become native metrics/style; Windows metrics conservatively cover every master's outline and control bounds |
| axes, masters, and instances                                                                             | converted to stable native entities and design locations                                                                          |
| line and cubic path nodes                                                                                | converted to master-local contours with relative handles and smooth/hard modes                                                    |
| components                                                                                               | recursively expanded per master with affine transforms; lost component editability is diagnosed                                   |
| glyph names, export state, notes, widths, and Unicode values                                             | converted to native glyph/layer/cmap data                                                                                         |
| default-master glyph and class kerning                                                                   | classes expanded to explicit native glyph pairs                                                                                   |
| classes, prefixes, and features                                                                          | returned as Adobe feature text only when the complete result passes create-font semantic analysis                                 |
| anchors, guides, backgrounds, special layers, per-master metrics/kerning, and instance export parameters | omitted with property-path warnings because editor v5 has no corresponding field                                                  |

Missing component references, cycles, invalid transforms/nodes, quadratic
curves, and invalid resulting editor state are errors. Component expansion is
memoized and rejects nesting beyond 64 references, or any master layer beyond
10,000 contours or two million points.

Parsing never depends on filesystem state. All stages are bounded and return
structured diagnostics instead of partially publishing a project.
