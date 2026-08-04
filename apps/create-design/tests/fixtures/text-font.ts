import {
	ingestVariableFont,
	serializeVariableFont,
	type VariableFontSource,
} from "@create-font/target"
import { makeGeometricOFont } from "../../../../packages/create-font/target/tests/fixtures/geometric-o.ts"

export function createTextFontFixtureBytes(): Uint8Array {
	const source = makeGeometricOFont()
	const template = source.glyphs[1]
	if (template === undefined) throw new Error("Missing glyph template.")
	const characters = [...new Set("Helowrdpinta")]
	const glyphs = characters.map((character) => ({
		...template,
		name: `uni${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
		advanceWidth: 600,
	}))
	const space = {
		...template,
		name: "space",
		advanceWidth: 300,
		leftSideBearing: 0,
		contours: [],
		variations: template.variations.map((variation) => ({
			...variation,
			deltas: { ...variation.deltas, points: [] },
		})),
	}
	const expanded: VariableFontSource = {
		...source,
		names: {
			...source.names,
			family: "Workspace Fixture",
			fullName: "Workspace Fixture",
			uniqueId: "CRFT:WorkspaceFixture:1",
			postScriptName: "WorkspaceFixture",
		},
		glyphs: [source.glyphs[0]!, ...glyphs, space],
		cmap: [
			...characters.map((character, index) => ({
				codePoint: character.codePointAt(0)!,
				glyph: index + 1,
			})),
			{ codePoint: 0x20, glyph: glyphs.length + 1 },
		],
	}
	const ingested = ingestVariableFont(expanded)
	if (!ingested.ok) throw new Error(JSON.stringify(ingested.errors))
	return serializeVariableFont(ingested.value)
}
