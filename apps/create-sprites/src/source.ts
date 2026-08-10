import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

import {
	createSpriteProject,
	normalizeSpriteProject,
	SPRITE_PROJECT_FORMAT,
	SPRITE_PROJECT_VERSION,
	type SpriteCel,
	type SpriteProject,
} from "./model.ts"

export const SPRITE_SOURCE_FORMAT = "create-sprites.source" as const
export const SPRITE_SOURCE_VERSION = 1 as const

interface SpriteSourceManifest {
	readonly format: typeof SPRITE_SOURCE_FORMAT
	readonly sourceVersion: typeof SPRITE_SOURCE_VERSION
	readonly documentFormat: typeof SPRITE_PROJECT_FORMAT
	readonly documentVersion: typeof SPRITE_PROJECT_VERSION
}

interface SpriteDocumentSource {
	readonly format: "create-sprites.metadata"
	readonly title: string
	readonly width: number
	readonly height: number
	readonly version: number
}

const MANIFEST: SpriteSourceManifest = {
	format: SPRITE_SOURCE_FORMAT,
	sourceVersion: SPRITE_SOURCE_VERSION,
	documentFormat: SPRITE_PROJECT_FORMAT,
	documentVersion: SPRITE_PROJECT_VERSION,
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"))
}

function assertManifest(value: unknown): asserts value is SpriteSourceManifest {
	if (typeof value !== "object" || value === null) throw new Error(`create-sprites.json must contain an object.`)
	const manifest = value as Partial<SpriteSourceManifest>
	if (manifest.format !== SPRITE_SOURCE_FORMAT || manifest.sourceVersion !== SPRITE_SOURCE_VERSION || manifest.documentFormat !== SPRITE_PROJECT_FORMAT || manifest.documentVersion !== SPRITE_PROJECT_VERSION)
		throw new Error(`Unsupported create-sprites source format.`)
}

export async function readSpriteSource(root: string): Promise<SpriteProject> {
	const sourceRoot = resolve(root)
	assertManifest(await readJson(join(sourceRoot, "create-sprites.json")))
	const [document, paletteValue, layersValue, framesValue, tagsValue] = await Promise.all([
		readJson(join(sourceRoot, "document.json")),
		readJson(join(sourceRoot, "palette.json")),
		readJson(join(sourceRoot, "layers", "index.json")),
		readJson(join(sourceRoot, "frames", "index.json")),
		readJson(join(sourceRoot, "tags", "index.json")),
	])
	if (typeof document !== "object" || document === null || (document as Partial<SpriteDocumentSource>).format !== "create-sprites.metadata") throw new Error(`document.json has an unsupported format.`)
	const metadata = document as SpriteDocumentSource
	if (!Array.isArray(paletteValue) || !Array.isArray(layersValue) || !Array.isArray(framesValue) || !Array.isArray(tagsValue)) throw new Error(`Sprite index files must contain arrays.`)
	const cels: SpriteCel[] = []
	for (const frame of framesValue as readonly { readonly id?: unknown }[]) {
		if (typeof frame.id !== "string") throw new Error(`Frame ids must be strings.`)
		for (const layer of layersValue as readonly { readonly id?: unknown }[]) {
			if (typeof layer.id !== "string") throw new Error(`Layer ids must be strings.`)
			try {
				const value = await readJson(join(sourceRoot, "cels", frame.id, `${layer.id}.json`))
				if (typeof value !== "object" || value === null || !Array.isArray((value as { rows?: unknown }).rows)) throw new Error(`Cel must contain rows.`)
				cels.push({ frameId: frame.id, layerId: layer.id, rows: (value as { rows: string[] }).rows })
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			}
		}
	}
	return normalizeSpriteProject({
		format: SPRITE_PROJECT_FORMAT,
		version: SPRITE_PROJECT_VERSION,
		title: metadata.title,
		width: metadata.width,
		height: metadata.height,
		palette: paletteValue,
		layers: layersValue,
		frames: framesValue,
		cels,
		tags: tagsValue,
	})
}

async function writeAtomically(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	const temporary = `${path}.create-sprites-tmp-${process.pid}`
	await writeFile(temporary, contents, "utf8")
	await rename(temporary, path)
}

export async function writeSpriteSource(root: string, input: SpriteProject): Promise<void> {
	const sourceRoot = resolve(root)
	const project = normalizeSpriteProject(input)
	await mkdir(sourceRoot, { recursive: true })
	await Promise.all([
		writeAtomically(join(sourceRoot, "create-sprites.json"), json(MANIFEST)),
		writeAtomically(join(sourceRoot, "document.json"), json({ format: "create-sprites.metadata", title: project.title, width: project.width, height: project.height, version: 1 } satisfies SpriteDocumentSource)),
		writeAtomically(join(sourceRoot, "palette.json"), json(project.palette)),
		writeAtomically(join(sourceRoot, "layers", "index.json"), json(project.layers)),
		writeAtomically(join(sourceRoot, "frames", "index.json"), json(project.frames)),
		writeAtomically(join(sourceRoot, "tags", "index.json"), json(project.tags)),
	])
	const celsRoot = join(sourceRoot, "cels")
	await rm(celsRoot, { force: true, recursive: true })
	for (const cel of project.cels) {
		await writeAtomically(join(celsRoot, cel.frameId, `${cel.layerId}.json`), json({ rows: cel.rows }))
	}
}

export async function createSpriteSource(
	root: string,
	options: Readonly<{ title?: string; width?: number; height?: number }> = {},
): Promise<SpriteProject> {
	const project = createSpriteProject(options.title, options.width, options.height)
	await writeSpriteSource(root, project)
	return project
}
