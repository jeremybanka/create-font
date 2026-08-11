import { describe, expect, it } from "vitest"

import { importGlyphsSource } from "../src/index.ts"
import { createFontEditorState } from "@create-font/states"

const glyphsFixture = `{
.appVersion = "3200";
familyName = "Import Test";
customParameters = (
{
name = Axes;
value = ({ Name = Weight; Tag = wght; });
}
);
fontMaster = (
{
ascender = 800;
capHeight = 700;
descender = -200;
id = regular;
weight = Regular;
weightValue = 400;
xHeight = 500;
},
{
ascender = 820;
capHeight = 720;
descender = -210;
id = bold;
weight = Bold;
weightValue = 700;
xHeight = 510;
}
);
glyphs = (
{
glyphname = base;
layers = (
{
layerId = regular;
paths = ({ closed = 1; nodes = ("0 0 LINE", "50 100 OFFCURVE", "100 100 OFFCURVE", "150 0 CURVE SMOOTH"); });
width = 200;
},
{
layerId = bold;
paths = ({ closed = 1; nodes = ("0 0 LINE", "50 110 OFFCURVE", "110 110 OFFCURVE", "160 0 CURVE SMOOTH"); });
width = 220;
}
);
leftKerningGroup = base;
rightKerningGroup = base;
unicode = 0062;
},
{
glyphname = composed;
layers = (
{ components = ({ name = base; transform = "{1, 0, 0, 1, 25, 10}"; }); layerId = regular; width = 250; },
{ components = ({ name = base; transform = "{1, 0, 0, 1, 30, 10}"; }); layerId = bold; width = 270; }
);
unicode = 0063;
}
);
features = ({ code = "sub base by composed;"; name = salt; });
instances = (
{ interpolationWeight = 400; name = Regular; },
{ interpolationWeight = 700; name = Bold; },
{ instanceInterpolations = { regular = 0.5; bold = 0.5; }; name = Medium; }
);
kerning = {
regular = { "@MMK_L_base" = { "@MMK_R_base" = -25; }; };
bold = { base = { composed = -40; }; };
};
unitsPerEm = 1000;
versionMajor = 1;
versionMinor = 23;
}`

// Compact Glyphs 3 fixture using the tuple/path, component, metrics, axis,
// Unicode, feature-tag, and kerningLTR spellings from the published format.
const glyphsV3Fixture = `{
.appVersion = "3210";
.formatVersion = 3;
axes = ({ default = 700; hidden = 1; name = Weight; tag = wght; });
familyName = "V3\\U0020Import";
metrics = (
{ type = ascender; },
{ type = "cap height"; },
{ type = "x-height"; },
{ type = descender; },
{ type = baseline; },
{ type = "italic angle"; }
);
fontMaster = (
{ axesValues = (400); id = regular; metricValues = ({ pos = 800; over = 10; }, { pos = 700; over = 8; }, { pos = 500; over = 6; }, { pos = -200; over = 9; }, { pos = 0; over = 12; }, { pos = 0; }); name = Regular; },
{ axesValues = (700); id = bold; metricValues = ({ pos = 820; over = 11; }, { pos = 720; over = 9; }, { pos = 510; over = 7; }, { pos = -210; over = 10; }, { pos = 0; over = 13; }, { pos = 0; }); name = Bold; }
);
glyphs = (
{
glyphname = nested;
layers = (
{ layerId = regular; shapes = ({ ref = composed; pos = (3, 4); scale = (1, 2); angle = 90; slant = (0, 0); }); width = 400; },
{ layerId = bold; shapes = ({ ref = composed; pos = (3, 4); scale = (1, 2); angle = 90; slant = (0, 0); }); width = 420; }
);
unicode = (110, 241);
},
{
glyphname = base;
kernRight = base;
layers = (
{ layerId = regular; shapes = ({ closed = 1; nodes = ((0, 0, l), (50, 100, o), (100, 100, o), (150, 0, cs, { name = point; })); }); width = 200; },
{ layerId = bold; shapes = ({ closed = 1; nodes = ((0, 0, l), (50, 110, o), (110, 110, o), (160, 0, cs)); }); width = 220; }
);
note = "escape\\a\\e\\v";
unicode = 98;
},
{
glyphname = composed;
kernLeft = base;
layers = (
{ layerId = regular; shapes = ({ ref = base; pos = (10, 20); scale = (2, 1); angle = 0; slant = (45, 0); }); width = 300; },
{ layerId = bold; shapes = ({ ref = base; pos = (10, 20); scale = (2, 1); angle = 0; slant = (45, 0); }); width = 320; }
);
unicode = 99;
},
{
glyphname = .notdef;
layers = ({ layerId = regular; shapes = (); width = 500; }, { layerId = bold; shapes = (); width = 500; });
}
);
classes = ({ code = "this is invalid"; disabled = 1; name = Broken; });
featurePrefixes = ({ code = "this is invalid"; disabled = 1; name = Broken; });
features = ({ code = "sub base by composed;"; tag = salt; });
instances = ({ axesValues = (700); name = Bold; });
kerningLTR = {
regular = {};
bold = {
base = { composed = -30; };
"@MMK_L_base" = { composed = -20; "@MMK_R_base" = -10; };
};
};
customParameters = ({ name = glyphOrder; value = (nested, base, composed, .notdef); });
unitsPerEm = 1000;
}`

const registeredAxesFixture = `{
.formatVersion = 3;
axes = (
{ default = 700; name = Weight; tag = wght; },
{ default = 75; name = Width; tag = wdth; },
{ default = -12; name = Slant; tag = slnt; },
{ default = 1; name = Italic; tag = ital; }
);
familyName = "Registered Style";
fontMaster = (
{ axesValues = (400, 100, 0, 0); ascender = 800; capHeight = 700; descender = -200; id = regular; name = Regular; xHeight = 500; },
{ axesValues = (700, 75, -12, 1); ascender = 800; capHeight = 700; descender = -200; id = italic; name = "Bold Italic"; xHeight = 500; }
);
glyphs = (
{ glyphname = .notdef; layers = ({ layerId = regular; shapes = (); width = 500; }, { layerId = italic; shapes = (); width = 500; }); },
{ glyphname = A; layers = (
{ layerId = regular; shapes = ({ closed = 1; nodes = ((0, 0, l), (50, 100, l), (100, 0, l)); }); width = 120; },
{ layerId = italic; shapes = ({ closed = 1; nodes = ((0, 0, l), (60, 100, l), (110, 0, l)); }); width = 130; }
); unicode = 65; }
);
unitsPerEm = 1000;
}`

function componentExpansionFixture(depth: number, references: number): string {
	const glyphs = Array.from({ length: depth + 1 }, (_, index) => {
		const shapes =
			index === 0
				? `paths = ({ closed = 1; nodes = ("0 0 LINE", "50 100 LINE", "100 0 LINE"); });`
				: `components = (${Array.from(
						{ length: references },
						() => `{ name = g${index - 1}; }`,
					).join(",")});`
		return `{ glyphname = g${index}; layers = ({ layerId = master; ${shapes} width = 100; }); }`
	})
		.reverse()
		.join(",")
	return `{ familyName = Limits; fontMaster = ({ id = master; }); glyphs = (${glyphs}); unitsPerEm = 1000; }`
}

describe("Glyphs.app import", () => {
	it("lowers masters, cubic paths, components, cmap, kerning, and features", () => {
		const result = importGlyphsSource(glyphsFixture)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		const { source } = result.value
		expect(source.names).toMatchObject({
			family: "Import Test",
			subfamily: "Regular",
			version: "Version 1.023",
		})
		expect(source.axes).toEqual([
			{
				id: "axis:wght",
				tag: "wght",
				name: "Weight",
				min: 400,
				default: 400,
				max: 700,
			},
		])
		expect(source.masters).toHaveLength(2)
		expect(source.instances[1]?.coordinates).toEqual({ "axis:wght": 700 })
		expect(source.instances[2]?.coordinates).toEqual({ "axis:wght": 550 })
		expect(source.cmap).toEqual([
			{ codePoint: 0x62, glyphId: "glyph:base" },
			{ codePoint: 0x63, glyphId: "glyph:composed" },
		])
		expect(source.glyphs[0]?.name).toBe(".notdef")
		const base = source.glyphs.find((glyph) => glyph.name === "base")
		const composed = source.glyphs.find((glyph) => glyph.name === "composed")
		expect(base?.layers[0]?.contours[0]?.points[0]?.outgoing).toEqual({
			x: 50,
			y: 100,
		})
		expect(base?.layers[0]?.contours[0]?.points[1]).toMatchObject({
			incoming: { x: -50, y: 100 },
			mode: "soft",
		})
		expect(composed?.layers[0]?.contours[0]?.points[0]).toMatchObject({
			x: 25,
			y: 10,
		})
		expect(source.kerning).toContainEqual({
			left: "glyph:base",
			right: "glyph:base",
			value: -25,
		})
		expect(result.value.featureSource).toContain("feature salt {")
		expect(result.value.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "glyphs.unsupported_data",
					message: expect.stringContaining("expanded to contours"),
				}),
				expect.objectContaining({
					code: "glyphs.unsupported_kerning",
					message: expect.stringContaining("Only default-master kerning"),
				}),
			]),
		)
	})

	it("imports authentic Glyphs 3 records and composes nested affine components", () => {
		const result = importGlyphsSource(glyphsV3Fixture)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		const { source } = result.value
		expect(source.names).toMatchObject({
			family: "V3 Import",
			subfamily: "Bold",
		})
		expect(source.defaultMasterId).toBe("master:bold")
		expect(source.axes).toEqual([
			{
				id: "axis:wght",
				tag: "wght",
				name: "Weight",
				min: 400,
				default: 700,
				max: 700,
				hidden: true,
			},
		])
		expect(source.style).toMatchObject({ weightClass: 700, bold: true })
		expect(source.metrics).toMatchObject({
			ascender: 820,
			descender: -210,
			winAscent: 820,
			winDescent: 336,
			overshoots: {
				baseline: 13,
				ascender: 11,
				descender: 10,
				xHeight: 7,
				capHeight: 9,
			},
		})
		expect(source.glyphs[0]?.name).toBe(".notdef")
		const base = source.glyphs.find((glyph) => glyph.name === "base")
		const nested = source.glyphs.find((glyph) => glyph.name === "nested")
		expect(base?.note).toBe("escape\x07\x1b\v")
		expect(base?.layers[0]?.contours[0]?.points[0]?.outgoing).toEqual({
			x: 50,
			y: 100,
		})
		expect(nested?.layers[0]?.contours[0]?.points[0]?.x).toBeCloseTo(43)
		expect(nested?.layers[0]?.contours[0]?.points[0]?.y).toBeCloseTo(-6)
		expect(nested?.layers[0]?.contours[0]?.points[1]?.x).toBeCloseTo(43)
		expect(nested?.layers[0]?.contours[0]?.points[1]?.y).toBeCloseTo(-306)
		expect(source.cmap).toEqual(
			expect.arrayContaining([
				{ codePoint: 98, glyphId: "glyph:base" },
				{ codePoint: 110, glyphId: "glyph:nested" },
				{ codePoint: 241, glyphId: "glyph:nested" },
			]),
		)
		expect(source.kerning).toContainEqual({
			left: "glyph:base",
			right: "glyph:composed",
			value: -30,
		})
		expect(result.value.featureSource).toContain("feature salt {")
	})

	it("derives registered-axis style defaults accepted by target ingestion", () => {
		const result = importGlyphsSource(registeredAxesFixture)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.source.defaultMasterId).toBe("master:italic")
		expect(result.value.source.style).toEqual({
			weightClass: 700,
			widthClass: 3,
			italic: true,
			bold: true,
			oblique: false,
			italicAngle: -12,
		})
		const editor = createFontEditorState({ key: "glyphs/registered-style" })
		editor.actions.load(result.value.source)
		expect(editor.read.compilation().ok).toBe(true)
	})

	it("rejects declared defaults that do not exactly match a complete master", () => {
		const result = importGlyphsSource(
			registeredAxesFixture.replace("default = 700", "default = 550"),
		)

		expect(result).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.invalid_value",
					path: "$.axes",
					message: expect.stringContaining("exactly match one font master"),
				}),
			],
		})
	})

	it("returns a source position for malformed property lists", () => {
		const result = importGlyphsSource("{\nfamilyName = MissingSemicolon\n}")

		expect(result).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.parse",
					line: 3,
					column: 1,
				}),
			],
		})
	})

	it("rejects quadratic outlines instead of silently changing them", () => {
		const result = importGlyphsSource(
			glyphsFixture.replace(
				'"50 100 OFFCURVE", "100 100 OFFCURVE", "150 0 CURVE SMOOTH"',
				'"75 100 OFFCURVE", "150 0 QCURVE SMOOTH"',
			),
		)

		expect(result).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "glyphs.unsupported_curve" }),
			]),
		})
	})

	it("omits feature text that would invalidate the native project", () => {
		const result = importGlyphsSource(
			glyphsFixture.replace("sub base by composed;", "pos base 10;"),
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.featureSource).toBeUndefined()
		expect(result.value.warnings).toContainEqual(
			expect.objectContaining({ code: "glyphs.unsupported_feature" }),
		)
	})

	it("covers off-curve control bounds in Windows metrics", () => {
		const result = importGlyphsSource(
			glyphsFixture.replaceAll("50 100 OFFCURVE", "50 1200 OFFCURVE"),
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.source.metrics.winAscent).toBe(1210)
	})

	it("does not map Unicode to non-exporting glyphs", () => {
		const result = importGlyphsSource(
			glyphsFixture.replace(
				"glyphname = base;",
				"export = 0; glyphname = base;",
			),
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.value.source.cmap).not.toContainEqual(
			expect.objectContaining({ glyphId: "glyph:base" }),
		)
		expect(result.value.warnings).toContainEqual(
			expect.objectContaining({
				code: "glyphs.unsupported_data",
				message: expect.stringContaining("non-exporting glyphs"),
			}),
		)
	})

	it("bounds parser nesting and rejects unsupported and binary formats", () => {
		const nested = `${"(".repeat(257)}value${")".repeat(257)}`
		expect(importGlyphsSource(nested)).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.resource_limit",
					message: expect.stringContaining("nesting depth"),
				}),
			],
		})
		expect(
			importGlyphsSource(`{ value = "${"x".repeat(1_048_577)}"; }`),
		).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.resource_limit",
					message: expect.stringContaining("token limit"),
				}),
			],
		})
		expect(importGlyphsSource("bplist00payload")).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.parse",
					message: expect.stringContaining("Binary property lists"),
				}),
			],
		})
		expect(importGlyphsSource("é".repeat(16_777_217))).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({
					code: "glyphs.resource_limit",
					message: expect.stringContaining("32 MiB"),
				}),
			],
		})
		expect(importGlyphsSource("{ formatVersion = 4; }")).toEqual({
			ok: false,
			errors: [expect.objectContaining({ code: "glyphs.unsupported_version" })],
		})
	})

	it("rejects missing component geometry, cycles, identifier collisions, and v3 hexadecimal Unicode", () => {
		const missing = glyphsV3Fixture.replace("ref = base", "ref = absent")
		expect(importGlyphsSource(missing)).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "glyphs.missing_component" }),
			]),
		})

		const cycle = glyphsV3Fixture.replace(
			"ref = composed; pos = (3, 4)",
			"ref = nested; pos = (3, 4)",
		)
		expect(importGlyphsSource(cycle)).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({ code: "glyphs.component_cycle" }),
			]),
		})

		const invalidUnicode = glyphsV3Fixture.replace(
			"unicode = 98;",
			"unicode = ABC;",
		)
		expect(importGlyphsSource(invalidUnicode)).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "glyphs.invalid_value",
					message: expect.stringContaining("decimal"),
				}),
			]),
		})

		const collision = glyphsV3Fixture
			.replace("glyphname = composed;", "glyphname = base/;")
			.replace("glyphname = .notdef;", "glyphname = base_;")
		expect(importGlyphsSource(collision)).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "glyphs.invalid_value",
					message: expect.stringContaining("same create-font ID"),
				}),
			]),
		})
	})

	it("bounds component nesting and expanded output", () => {
		expect(importGlyphsSource(componentExpansionFixture(65, 1))).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "glyphs.resource_limit",
					message: expect.stringContaining("maximum depth"),
				}),
			]),
		})
		expect(importGlyphsSource(componentExpansionFixture(14, 2))).toEqual({
			ok: false,
			errors: expect.arrayContaining([
				expect.objectContaining({
					code: "glyphs.resource_limit",
					message: expect.stringContaining("contours"),
				}),
			]),
		})
	})
})
