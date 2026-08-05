# `@create-design/svg`

Headless, deterministic SVG interchange for the vector subset represented by
`@create-design/source`. The package projects one named artboard, serializes
standards-oriented SVG bytes for browser and CLI consumers, imports supported
SVG geometry with fresh identities, and reports unsupported content instead of
silently rasterizing or deleting it.

```ts
import { exportSvg, importSvg } from "@create-design/svg"

const bytes = exportSvg(document, { artboardId: "artboard:page" })
const imported = importSvg(new TextDecoder().decode(bytes), document, {
	nextId: crypto.randomUUID,
})
```

Import supports paths (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, and `Z`),
rectangles, ellipses, circles, lines, polygons, polylines, nested groups,
affine transforms, solid fills, and strokes. The current source model has no
gradient, text, filter, mask, or image entities, so those are returned as
structured diagnostics.

SVG export uses the shared model output projection. Editable layer boundaries
flatten in canonical order because this interchange does not encode the
create-design layer model; nested groups remain ordinary SVG groups. Hidden
layers emit no elements, locked layers remain visually unchanged, live blends
lower to ordinary paths, and diagnostics retain containing-layer identity.
