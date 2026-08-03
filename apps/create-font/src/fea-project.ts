import { readFile, readdir } from "node:fs/promises"
import { join, relative, resolve, sep } from "node:path"

import {
	analyzeFeaProject,
	featureIndexFileSchema,
	type FeaProjectAnalysis,
	type FontSourceDirectoryFiles,
} from "@create-font/source"
import type { EditorFontSource } from "@create-font/states"

async function collectFeatureSources(
	root: string,
	directory = join(root, `features`),
): Promise<ReadonlyMap<string, string>> {
	const sources = new Map<string, string>()
	for (const entry of await readdir(directory, { withFileTypes: true }).catch(
		() => [],
	)) {
		const absolute = join(directory, entry.name)
		if (entry.isDirectory()) {
			for (const [path, source] of await collectFeatureSources(root, absolute))
				sources.set(path, source)
		} else if (entry.isFile() && entry.name.endsWith(`.fea`)) {
			sources.set(
				relative(root, absolute).split(sep).join(`/`),
				await readFile(absolute, `utf8`),
			)
		}
	}
	return sources
}

export function analyzeFontSourceFeatures(
	values: FontSourceDirectoryFiles,
	source: EditorFontSource,
): FeaProjectAnalysis {
	const entries =
		(values[`features/index.json`] as
			| readonly { readonly path: string }[]
			| undefined) ?? []
	const sources = new Map(
		Object.entries(values).flatMap(([path, value]) =>
			path.startsWith(`features/`) &&
			path.endsWith(`.fea`) &&
			typeof value === `string`
				? [[path, value] as const]
				: [],
		),
	)
	return analyzeFeaProject({
		entries: entries.map((entry) => entry.path),
		glyphs: source.glyphs.map((glyph, id) => ({
			export: glyph.export,
			id,
			name: glyph.name,
		})),
		sources,
	})
}

export async function analyzeFontProjectFeatures(
	rootInput: string,
	source?: EditorFontSource,
	overrides: ReadonlyMap<string, string> = new Map(),
): Promise<FeaProjectAnalysis> {
	const root = resolve(rootInput)
	const indexText = await readFile(join(root, `features`, `index.json`), `utf8`)
	const entries = featureIndexFileSchema.parse(JSON.parse(indexText))
	const sources = new Map(await collectFeatureSources(root))
	const openEntries: string[] = []
	for (const [inputPath, text] of overrides) {
		const path = inputPath.startsWith(root)
			? relative(root, inputPath).split(sep).join(`/`)
			: inputPath
		if (path.startsWith(`features/`) && path.endsWith(`.fea`)) {
			sources.set(path, text)
			openEntries.push(path)
		}
	}
	const glyphs =
		source?.glyphs.map((glyph, id) => ({
			export: glyph.export,
			id,
			name: glyph.name,
		})) ??
		(await Promise.all(
			(
				JSON.parse(
					await readFile(join(root, `glyphs`, `index.json`), `utf8`),
				) as readonly { readonly path: string }[]
			).map(async (entry, id) => {
				const glyph = JSON.parse(
					await readFile(join(root, entry.path), `utf8`),
				) as { readonly export?: boolean; readonly name: string }
				return {
					export: glyph.export ?? true,
					id,
					name: glyph.name,
				}
			}),
		))
	return analyzeFeaProject({
		entries: [...entries.map((entry) => entry.path), ...openEntries],
		glyphs,
		sources,
	})
}
