import { randomUUID } from "node:crypto"
import { link, mkdir, open, realpath, rename, rm } from "node:fs/promises"
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path"

import {
	exportSvg,
	preflightSvgExport,
	svgPreflightAllowsOutput,
	type SvgDiagnostic,
	type SvgPreflightResult,
} from "@create-design/svg"
import { resolveDesignArtboardLinks } from "@create-design/model"
import {
	assembleDesignDocument,
	assetIndexFileSchema,
	type DesignImageResource,
	type DesignSourceDiagnostic,
} from "@create-design/source"

import { createDesignSourceService } from "./source-service.ts"
import { loadDesignLinkedArtboardResources } from "./linked-artboard-export.ts"

export interface DesignSvgExportOptions {
	readonly artboardIds?: readonly string[]
	readonly force?: boolean
	readonly output: string
	readonly root: string
}

export interface DesignSvgExportResult {
	readonly artboardId: string
	readonly byteLength: number
	readonly output: string
	readonly preflight: SvgPreflightResult
	readonly sourceRevision: string
}

export class DesignSvgSourceError extends Error {
	readonly diagnostics: readonly DesignSourceDiagnostic[]
	constructor(diagnostics: readonly DesignSourceDiagnostic[]) {
		super("The create-design source project is not valid.")
		this.name = "DesignSvgSourceError"
		this.diagnostics = diagnostics
	}
}

export class DesignSvgPreflightError extends Error {
	readonly preflight: SvgPreflightResult
	constructor(preflight: SvgPreflightResult) {
		super("SVG export was blocked by preflight errors.")
		this.name = "DesignSvgPreflightError"
		this.preflight = preflight
	}
}

export class DesignSvgOutputExistsError extends Error {
	readonly output: string

	constructor(output: string) {
		super(`Output already exists: ${output}. Pass --force to replace it.`)
		this.name = "DesignSvgOutputExistsError"
		this.output = output
	}
}

const errorCode = (error: unknown): string | undefined =>
	error !== null && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined

function pathIsInside(root: string, candidate: string): boolean {
	const candidateRelative = relative(root, candidate)
	return (
		candidateRelative === "" ||
		(candidateRelative !== ".." &&
			!candidateRelative.startsWith(`..${sep}`) &&
			!isAbsolute(candidateRelative))
	)
}

async function canonicalFuturePath(path: string): Promise<string> {
	let ancestor = dirname(path)
	const descendants = [basename(path)]
	for (;;) {
		try {
			return resolve(await realpath(ancestor), ...descendants)
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error
			const parent = dirname(ancestor)
			if (parent === ancestor) throw error
			descendants.unshift(basename(ancestor))
			ancestor = parent
		}
	}
}

function assertOutputOutsideRoot(root: string, output: string): void {
	if (!pathIsInside(root, output)) return
	throw new Error(
		`SVG output must be outside the source project so generated files cannot invalidate it: ${output}`,
	)
}

async function writeSvgAtomically(
	output: string,
	bytes: Uint8Array,
	force: boolean,
): Promise<void> {
	await mkdir(dirname(output), { recursive: true })
	const temporary = resolve(
		dirname(output),
		`.${basename(output)}.${process.pid}.${randomUUID()}.tmp`,
	)
	let file: Awaited<ReturnType<typeof open>> | undefined
	try {
		file = await open(temporary, "wx", 0o666)
		await file.writeFile(bytes)
		await file.sync()
		await file.close()
		file = undefined
		if (force) await rename(temporary, output)
		else {
			try {
				await link(temporary, output)
			} catch (error) {
				if (errorCode(error) === "EEXIST")
					throw new DesignSvgOutputExistsError(output)
				throw error
			}
		}
	} finally {
		await file?.close().catch(() => undefined)
		await rm(temporary, { force: true }).catch(() => undefined)
	}
}

export async function exportDesignSvg(
	options: DesignSvgExportOptions,
): Promise<DesignSvgExportResult> {
	const root = resolve(options.root)
	const output = resolve(options.output)
	if (extname(output).toLowerCase() !== ".svg")
		throw new Error(`SVG output path must end in .svg: ${output}`)
	if (options.artboardIds !== undefined && options.artboardIds.length !== 1)
		throw new Error("SVG export requires exactly one --artboards ID.")
	assertOutputOutsideRoot(root, output)
	const canonicalRoot = await realpath(root)
	assertOutputOutsideRoot(canonicalRoot, await canonicalFuturePath(output))
	const source = await createDesignSourceService(canonicalRoot, {
		initialize: false,
	})
	const snapshot = await source.readSnapshot()
	const assembled = assembleDesignDocument(
		Object.fromEntries(snapshot.units.map(({ path, value }) => [path, value])),
	)
	if (!assembled.ok) throw new DesignSvgSourceError(assembled.errors)
	const assetIndexUnit = snapshot.units.find(
		({ path }) => path === "assets/index.json",
	)
	const assetIndex = assetIndexFileSchema.safeParse(assetIndexUnit?.value)
	const imageResources = new Map<string, DesignImageResource>(
		assetIndex.success
			? await Promise.all(
					assetIndex.data.entries
						.filter(
							(entry) =>
								entry.mediaType === "image/jpeg" ||
								entry.mediaType === "image/png",
						)
						.map(async (entry) => {
							const asset = await source.readAsset(entry.path)
							const mediaType =
								entry.mediaType === "image/jpeg" ? "image/jpeg" : "image/png"
							return [
								entry.id,
								{
									id: entry.id,
									mediaType,
									bytes: new Uint8Array(
										await new Response(asset.bytes).arrayBuffer(),
									),
								},
							] as const
						}),
				)
			: [],
	)
	const links = resolveDesignArtboardLinks(
		assembled.value,
		await loadDesignLinkedArtboardResources(canonicalRoot),
	)
	for (const resource of links.imageResources)
		imageResources.set(resource.id, resource)
	const artboardId =
		options.artboardIds?.[0] ?? assembled.value.artboards[0]?.id
	if (artboardId === undefined)
		throw new Error("SVG export requires one artboard.")
	const target = { artboardId }
	const projectionOptions = { imageResources }
	const preflight = preflightSvgExport(
		links.document,
		target,
		projectionOptions,
	)
	if (!svgPreflightAllowsOutput(preflight))
		throw new DesignSvgPreflightError(preflight)
	const bytes = exportSvg(links.document, target, projectionOptions)
	await writeSvgAtomically(output, bytes, options.force === true)
	return Object.freeze({
		artboardId,
		byteLength: bytes.byteLength,
		output,
		preflight,
		sourceRevision: snapshot.revision,
	})
}

export function formatSvgDiagnostic(diagnostic: SvgDiagnostic): string {
	return `${diagnostic.severity} ${diagnostic.code}${diagnostic.entityId === undefined ? "" : ` [${diagnostic.entityId}]`}: ${diagnostic.message}`
}
