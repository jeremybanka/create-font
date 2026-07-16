# @trigraph/target

`@trigraph/target` is a rigorously validated, low-level TypeScript
representation of an OpenType variable font. It is a logical SFNT: one step
after design-space or master compilation, and one step before binary font
serialization.

This library is the low-level compilation target of the public `trigraph` npm
toolchain. The unscoped package now provides the preliminary
package-manager-resolved CLI and Elysia/Eden server boundary while depending on
the workspace's implementation layers. The complete build pipeline will feed
this validated target as an independently usable API. The project source
directory, bundled editor assets, and binary serializer are roadmap work; see
the repository
[architecture](../../docs/architecture.md) and
[roadmap](../../docs/roadmap.md).

Version 1 models the meaning needed to produce a TrueType-flavored variable
font, not the byte layout of its tables. Glyph IDs, default outlines, metrics,
axes, normalized variation regions, complete deltas, names, and character
mappings are already resolved. A future binary lowerer should only have to
pack the selected records, assign offsets and name IDs, and calculate checksums.
`createLoweringPlan` already derives the shared `head`, `hhea`, `maxp`, glyph,
table-directory, canonical encoding, and exact table-length facts needed by
that serializer.

## Version 1 profile

The v1 schema is deliberately closed. Unknown properties are ingestion errors,
and the profile supports only:

- one variable-font resource with at least one axis;
- unhinted, simple quadratic TrueType glyphs, including empty glyphs;
- a fixed glyph order with glyph 0 named `.notdef`;
- default-instance `glyf` outlines and `hmtx` metrics;
- `gvar` tuple regions with complete deltas for every contour point, plus four
  explicit phantom-point deltas;
- optional per-axis `avar` maps and named instances;
- a non-empty Unicode character map.

Complete point coverage is intentional: sparse `gvar` data and IUP inference
are serialization optimizations, not part of the v1 logical contract. Composite
glyphs, instructions, and component-relative variation are also outside this
version. A future serializer may omit point deltas only after proving that IUP
inference reproduces the complete logical deltas exactly.

Glyph names are unique logical identifiers for compilation and diagnostics.
They deliberately disappear when v1 lowers to a format-3.0 `post` table, which
has no glyph-name array; they are not constrained as PostScript glyph names.

## Source values and validated fonts

Authoring code uses `VariableFontSource` and the other `*Source` interfaces.
Their fields are ordinary JavaScript strings, numbers, booleans, arrays, and
optional `bigint` timestamps, so they are convenient to construct from decoded
data. Ingestion accepts inert own-property data objects and dense ordinary
arrays; inherited fields, accessors, array subclasses, and extra properties are
rejected rather than observed as schema data.

`ingestVariableFont(value: unknown)` is the only supported route to a
`VariableFont`. It validates and clones the source, converts coordinate records
to axis-ordered tuples, supplies optional defaults, sorts the character map,
returns branded scalar-domain types, and deeply freezes the entire result. The
validated font type carries a private nominal compile-time proof, and lowering
and evaluation APIs verify the originating object in a runtime proof set. An
object spread or type assertion therefore cannot turn edited data back into a
validated font.

Ingestion does not throw for validation failures. It returns:

- `{ ok: true, value, warnings }` with a branded, deeply frozen
  `VariableFont`; or
- `{ ok: false, errors, warnings }`, where `errors` is statically non-empty.

Every diagnostic has a stable `code`, JSONPath-like `path`, human-readable
`message`, `severity`, and associated OpenType `table`. Diagnostics are sorted
deterministically. Warnings do not prevent a successful result.

## Geometric O example

This minimal source uses the razor design as the default `wght` instance and a
single normalized tuple for the Black extreme. Both visible glyphs are the same
geometric O; the Black delta closes most of the counter without changing its
topology.

```ts
import {
	TRIGRAPH_FORMAT,
	TRIGRAPH_IR_VERSION,
	createLoweringPlan,
	ingestVariableFont,
	type SimpleGlyphSource,
	type VariableFontSource,
} from "@trigraph/target"

const contours = [
	[
		{ x: 100, y: 0, onCurve: true },
		{ x: 100, y: 700, onCurve: true },
		{ x: 700, y: 700, onCurve: true },
		{ x: 700, y: 0, onCurve: true },
	],
	[
		{ x: 120, y: 20, onCurve: true },
		{ x: 680, y: 20, onCurve: true },
		{ x: 680, y: 680, onCurve: true },
		{ x: 120, y: 680, onCurve: true },
	],
] as const

const blackVariation = {
	region: { peak: { wght: 1 } },
	deltas: {
		points: [
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 180, y: 280 },
			{ x: -180, y: 280 },
			{ x: -180, y: -280 },
			{ x: 180, y: -280 },
		],
		phantom: { left: 0, right: 0, top: 0, bottom: 0 },
	},
} as const

const geometricO = (name: string): SimpleGlyphSource => ({
	kind: "simple",
	name,
	advanceWidth: 800,
	leftSideBearing: 100,
	contours,
	variations: [blackVariation],
})

const source = {
	format: TRIGRAPH_FORMAT,
	irVersion: TRIGRAPH_IR_VERSION,
	metadata: {
		unitsPerEm: 1024,
		fontRevision: 1,
		vendorId: "TRIG",
		lowestPpem: 9,
	},
	names: {
		family: "Trigraph O",
		subfamily: "Razor",
		uniqueId: "Trigraph O Razor 1.000",
		fullName: "Trigraph O Razor",
		version: "Version 1.000",
		postScriptName: "TrigraphO-Razor",
		typographicFamily: "Trigraph O",
		typographicSubfamily: "Razor",
	},
	metrics: {
		ascender: 800,
		descender: -224,
		lineGap: 0,
		winAscent: 800,
		winDescent: 224,
		xHeight: 512,
		capHeight: 700,
		underlinePosition: -100,
		underlineThickness: 50,
	},
	style: {
		weightClass: 100,
		widthClass: 5,
		italic: false,
		bold: false,
		oblique: false,
		italicAngle: 0,
	},
	axes: [
		{
			tag: "wght",
			name: "Weight",
			min: 100,
			default: 100,
			max: 900,
		},
	],
	instances: [
		{
			name: "Black",
			coordinates: { wght: 900 },
			postScriptName: "TrigraphO-Black",
		},
	],
	glyphs: [geometricO(".notdef"), geometricO("O")],
	cmap: [{ codePoint: 0x4f, glyph: 1 }],
} satisfies VariableFontSource

const result = ingestVariableFont(source)
if (!result.ok) {
	throw new Error(
		result.errors
			.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
			.join("\n"),
	)
}

const font = result.value // VariableFont, branded and deeply frozen
const plan = createLoweringPlan(font) // deterministic derived SFNT facts
```

Omit an axis `map` for identity normalization. When supplied, it is expressed
in exact normalized F2Dot14 values and must include `-1 -> -1`, `0 -> 0`, and
`1 -> 1`.

## Enforced invariants

Ingestion currently enforces the following major constraints:

- **Shape:** every parsed object has an exact property set; scalar values have
  the required runtime type, integer range, or exact Fixed16.16/F2Dot14
  representation.
- **Axes:** tags are valid and unique; registered axes stay within registered
  ranges; `min < max`; defaults and instance coordinates are in range; every
  coordinate record has exactly the declared axes; named locations are unique.
- **`avar`:** source coordinates are strictly increasing, target coordinates
  are nondecreasing, and the three required anchors are present.
- **Regions:** normalized tuples contain every axis, peaks are nonzero, and
  intermediate supports satisfy `start <= peak <= end` without crossing zero
  around a nonzero peak.
- **Glyphs:** names are unique, `.notdef` is first, contours are non-empty,
  points remain within the TrueType grid from -16,384 through 16,383 FUnits,
  relative `glyf` coordinate deltas fit signed 16-bit fields, and glyph/table
  counts fit their OpenType fields.
- **Metrics:** advances fit unsigned 16-bit fields; an empty glyph has zero LSB;
  otherwise LSB equals `xMin`, as required for variable TrueType fonts. Derived
  `hhea` extrema and `OS/2.xAvgCharWidth` must be representable, and Windows
  ascent/descent must cover the supplied vertical variation. One-axis bounds
  are evaluated exactly at every piecewise support boundary; multi-axis bounds
  use a conservative closed-profile proof and can reject a font whose regions
  are safe only because some multi-axis supports are mutually exclusive.
- **`gvar`:** a glyph has at most 4,095 tuples; each tuple has exactly one delta
  per flattened contour point and all four phantom deltas; packed-header limits
  remain encodable.
- **Style and names:** required names are non-empty and fit name-table storage;
  version and PostScript names have valid syntax; `wght`, `wdth`, `slnt`, and
  `ital` defaults agree with the corresponding `OS/2`/`post` values and flags.
- **`cmap`:** at least one unique Unicode scalar maps to an in-range glyph ID;
  surrogate values are rejected and successful maps are sorted by code point.
  BMP-only maps must fit the selected Windows format-4 packing; maps containing
  supplementary characters use format 12. A BMP-only U+FFFF mapping is rejected
  because that code point is the required format-4 terminal segment.

Recommendations are warnings: a power-of-two `unitsPerEm`, a visible `.notdef`
outline, default-location instance names that reuse the font's default names,
and avoiding simultaneous `ital` and `slnt` axes unless both are truly needed.

## Binary lowering target

OpenType requires eight tables in any functional outline font and adds
TrueType- and variation-specific requirements. A v1 font lowers to these 13
required tables:

`cmap`, `head`, `hhea`, `hmtx`, `maxp`, `name`, `OS/2`, `post`, `glyf`, `loca`,
`fvar`, `gvar`, and `STAT`.

A lowerer would additionally emit an `avar` table when an axis has a non-null
map. `HVAR` is not required for TrueType outlines because `gvar` carries metric
variation through phantom points, though the OpenType specification recommends
adding it for performance.

The logical model intentionally excludes binary-only and redundant fields.
`createLoweringPlan(font)` currently derives immutable glyph bounds/counts,
`head` bounds, `hhea` extrema and compression, `maxp` values, and the sorted
table set. Its encoding plan fixes long `loca` and `gvar` offsets, uncompressed
`glyf` coordinates, complete private point lists, no shared `gvar` tuples,
Windows format 4 or 12 `cmap`, `OS/2` version 4, `post` format 3.0, STAT axis
value format, name-record counts, every table length, and the padded SFNT size.
A binary lowerer should consume those decisions and finish only byte-level work:

- the SFNT directory, table order, offsets, four-byte padding, table checksums,
  and `head.checksumAdjustment`;
- `head` flags and the already-planned bounds and `indexToLocFormat`;
- packed `glyf` flags and relative coordinates, planned long `loca` offsets,
  `hmtx` records, and the already-derived `maxp`/`hhea` values;
- the planned `cmap`, `name`, `OS/2`, and format-3.0 `post` records, including
  custom name-ID assignment and Unicode-range coverage fields;
- `fvar`/`STAT` name references and headers, plus the planned private `gvar`
  tuples, delta runs, long offsets, and flags.

Those choices must not repair or reinterpret the design. If lowering requires
new design decisions, the input belongs in a higher-level compiler rather than
this IR.

## Non-goals and next steps

Trigraph does not yet write `.ttf` files or ingest existing font binaries. It is
not a design-space/master compiler: `deriveSimpleGlyphDeltas` is a narrow
topology-checking subtraction helper, and `instantiateGlyph` is a conformance
evaluator for already-compiled tuple data. Version 1 excludes composite glyphs,
TrueType instructions, sparse/IUP `gvar`, `HVAR`, `MVAR`, vertical metrics,
CFF/CFF2, OpenType Layout, color, and bitmap tables.

The next lower layer is a deterministic serializer for the 13-table profile.
Higher-level packages can then target `VariableFontSource`, use ingestion as the
technical validity boundary, and hand only a validated `VariableFont` to that
serializer.

## OpenType references

The contract follows the authoritative OpenType 1.9.1 specification:

- [The OpenType Font File](https://learn.microsoft.com/en-us/typography/opentype/spec/otff)
  defines required SFNT tables, alignment, and checksums; the
  [Font Variations overview](https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview)
  requires `fvar` and `STAT`, and `gvar` for TrueType variable outlines.
- [`fvar`](https://learn.microsoft.com/en-us/typography/opentype/spec/fvar),
  [`avar`](https://learn.microsoft.com/en-us/typography/opentype/spec/avar),
  [`gvar`](https://learn.microsoft.com/en-us/typography/opentype/spec/gvar),
  [variation common formats](https://learn.microsoft.com/en-us/typography/opentype/spec/otvarcommonformats),
  and [`STAT`](https://learn.microsoft.com/en-us/typography/opentype/spec/stat)
  define the variable-font model and point-number semantics.
- [`glyf`](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf),
  [`loca`](https://learn.microsoft.com/en-us/typography/opentype/spec/loca),
  [`head`](https://learn.microsoft.com/en-us/typography/opentype/spec/head),
  [`hhea`](https://learn.microsoft.com/en-us/typography/opentype/spec/hhea),
  [`hmtx`](https://learn.microsoft.com/en-us/typography/opentype/spec/hmtx), and
  [`maxp`](https://learn.microsoft.com/en-us/typography/opentype/spec/maxp)
  define TrueType outlines and their cross-table metrics.
- [`cmap`](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap),
  [`name`](https://learn.microsoft.com/en-us/typography/opentype/spec/name),
  [`OS/2`](https://learn.microsoft.com/en-us/typography/opentype/spec/os2),
  [`post`](https://learn.microsoft.com/en-us/typography/opentype/spec/post), and
  the [font recommendations](https://learn.microsoft.com/en-us/typography/opentype/spec/recom)
  cover installation-facing metadata and interoperability.
