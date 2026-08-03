# @create-font/font-service

Deterministic, runtime-portable OpenType shaping, metrics, and outline
extraction shared by interactive create-art canvases and noninteractive export.
The service is a foundation for editable text objects; it does not implement a
Type tool, line breaking into frames, fallback-font choice, or PDF subsetting.

## Contract

Callers supply font bytes. The service never discovers fonts, reads a path,
uses `FontFace`, or measures DOM/canvas text. `registerFont` immediately copies
the bytes, combines a source/family/face/revision descriptor with a stable
content fingerprint, validates the SFNT directory, and returns an immutable
`FontIdentity`. Registering a new revision for that logical face invalidates
only the old face and its derived cache entries. A failed replacement leaves
the prior revision registered.

```ts
import {
	createFontService,
	projectTextForBrowser,
	projectTextForExport,
} from "@create-font/font-service"

const service = createFontService()
const registered = service.registerFont(
	{ source: "asset:brand", family: "Brand Sans", revision: "sha256:…" },
	fontBytes,
)
if (registered.value === undefined) throw registered.diagnostics

const request = {
	font: registered.value.identity,
	text: "office\nسلام",
	direction: "auto" as const,
	features: [{ tag: "liga", value: 1 }],
	variations: { wght: 540 },
}

// Both adapters return the same cached immutable positioned-run object.
const canvasRun = projectTextForBrowser(service, request)
const exportRun = projectTextForExport(service, request)
```

The shaped-run boundary contains UTF-16 clusters, glyph IDs, advances,
offsets, extents, line baselines, font metrics, and structured diagnostics.
Outline extraction returns application-neutral move, line, quadratic, cubic,
and close commands. Coordinates and metrics are font units in a Cartesian
Y-up plane; subsequent lines have decreasing baselines. Horizontal and
vertical direction, explicit script/language, OpenType feature ranges, kerning,
and variation coordinates are part of the cache key.

Parsing, shaping, metrics, and outlines have independent caches. The cache
stats API exists for tests and profiling; consumers must not infer semantic
state from hit counts.

Diagnostics use stable codes:

- `font.missing`
- `font.malformed`
- `font.unsupported-table`
- `glyph.missing`
- `variation.unsupported-axis`
- `variation.out-of-range`

## Engine boundary and dependency decision

Public values contain no HarfBuzz objects. The package-private adapter is the
only place that constructs engine faces, fonts, buffers, features, and
variations, so another conforming engine can replace it without changing the
document/browser/export contract.

The initial engine is exact-pinned `harfbuzzjs@1.5.0`, the JavaScript/Wasm
distribution in the official
[`harfbuzz/harfbuzzjs`](https://github.com/harfbuzz/harfbuzzjs) repository. The
npm release is maintained by Ebrahim Byagowi and Khaled Hosny and has npm SLSA
provenance and a registry signature. The wrapper is MIT licensed. Its v1.5.0
tag embeds official HarfBuzz commit `4de187dd0a915d13c976fa8bd474c084229f3aab`;
that compiled native component uses HarfBuzz's Old MIT license. The dependency
has no production transitive dependencies. The lockfile records integrity
`sha512-IYrYhWlY6BqSJlzhYbc2sxuFaJQXGpl74+1060SBDnYLt1gyyyUWM9LUbn8c/IWedmFW7Jgi9l+uI5cj0GN+qA==`.

The runtime imports a 421,964-byte Wasm file (about 171 kB gzip) and an 82,428
byte ESM wrapper (about 17 kB gzip). Its unused subset Wasm is not imported.
On one Node 26 Linux cold-process sample, module initialization took 5.69 ms,
added about 8 MiB RSS, and about 0.9 MiB ArrayBuffer storage. Those values are
an indicative development measurement, not a performance guarantee. Load the
service lazily in applications that do not display text.

The ESM module uses top-level await. Node resolves and reads its sibling Wasm;
browsers and dedicated workers resolve it with `new URL(..., import.meta.url)`
and use streaming same-origin fetch with an ArrayBuffer fallback. That loading
is engine initialization, not font discovery: all font binaries still cross
the explicit service boundary.

Alternatives evaluated:

- The repository's Rust/`wasm-bindgen` packaging is proven, but currently owns
  feature-file parsing rather than a font engine. Adding Rustybuzz plus an
  outline/metrics parser such as skrifa would introduce and maintain two
  engines and a new ABI for the same contract.
- `rustybuzz-wasm` is a non-official, single-maintainer distribution last
  released in 2021, is larger unpacked, and does not offer the same integrated
  outline/metric surface.
- `fontkit` is about 5.6 MB unpacked with nine direct dependencies and uses a
  separate JavaScript shaping implementation rather than authoritative
  HarfBuzz behavior.
- `text-shaper` is a newer single-maintainer 0.x package and is not an official
  HarfBuzz binding.

Tests do not redistribute third-party fonts. They deterministically serialize
small fonts from repository-owned `@create-font/target` source fixtures at test
time, including GSUB, GPOS, marks, and variable outlines.
