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
	exportPng,
	preflightPngExport,
	type PngBackground,
	type PngDiagnostic,
	type PngExportRequest,
	type PngPreflightResult,
} from "@create-design/png"
import {
	assembleDesignDocument,
	type DesignSourceDiagnostic,
} from "@create-design/source"

import { createDesignSourceService } from "./source-service.ts"

export interface DesignPngExportOptions {
	readonly artboardIds?: readonly string[]
	readonly background?: PngBackground
	readonly force?: boolean
	readonly output: string
	readonly root: string
	readonly scale?: number
}

export interface DesignPngExportResult {
	readonly byteLength: number
	readonly outputs: readonly string[]
	readonly preflight: PngPreflightResult
	readonly sourceRevision: string
}

export class DesignPngSourceError extends Error {
	readonly diagnostics: readonly DesignSourceDiagnostic[]
	constructor(diagnostics: readonly DesignSourceDiagnostic[]) {
		super("The create-design source project is not valid.")
		this.name = "DesignPngSourceError"
		this.diagnostics = diagnostics
	}
}

export class DesignPngPreflightError extends Error {
	readonly preflight: PngPreflightResult
	constructor(preflight: PngPreflightResult) {
		super("PNG export was blocked by preflight errors.")
		this.name = "DesignPngPreflightError"
		this.preflight = preflight
	}
}

export class DesignPngOutputExistsError extends Error {
	readonly output: string
	constructor(output: string) {
		super(`Output already exists: ${output}. Pass --force to replace it.`)
		this.name = "DesignPngOutputExistsError"
		this.output = output
	}
}

const errorCode = (error: unknown): string | undefined =>
	error !== null && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined

function pathIsInside(root: string, candidate: string): boolean {
	const value = relative(root, candidate)
	return (
		value === "" ||
		(value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
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

async function writeAtomically(
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
		else
			try {
				await link(temporary, output)
			} catch (error) {
				if (errorCode(error) === "EEXIST")
					throw new DesignPngOutputExistsError(output)
				throw error
			}
	} finally {
		await file?.close().catch(() => undefined)
		await rm(temporary, { force: true }).catch(() => undefined)
	}
}

function slug(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replaceAll(/[^a-z0-9]+/gu, "-")
			.replaceAll(/^-|-$/gu, "") || "untitled"
	)
}

function batchOutput(
	output: string,
	index: number,
	artboardName: string,
): string {
	return resolve(
		dirname(output),
		`${basename(output, extname(output))}-${String(index + 1).padStart(2, "0")}-${slug(artboardName)}.png`,
	)
}

export async function exportDesignPng(
	options: DesignPngExportOptions,
): Promise<DesignPngExportResult> {
	const root = resolve(options.root)
	const output = resolve(options.output)
	if (extname(output).toLowerCase() !== ".png")
		throw new Error(`PNG output path must end in .png: ${output}`)
	if (pathIsInside(root, output))
		throw new Error(`PNG output must be outside the source project: ${output}`)
	const canonicalRoot = await realpath(root)
	if (pathIsInside(canonicalRoot, await canonicalFuturePath(output)))
		throw new Error(`PNG output must be outside the source project: ${output}`)
	const source = await createDesignSourceService(canonicalRoot, {
		initialize: false,
	})
	const snapshot = await source.readSnapshot()
	const assembled = assembleDesignDocument(
		Object.fromEntries(snapshot.units.map(({ path, value }) => [path, value])),
	)
	if (!assembled.ok) throw new DesignPngSourceError(assembled.errors)
	const scope: PngExportRequest["scope"] =
		options.artboardIds === undefined
			? { kind: "all" }
			: { kind: "selected", artboardIds: options.artboardIds }
	const request: PngExportRequest = {
		scope,
		...(options.background === undefined
			? {}
			: { background: options.background }),
		...(options.scale === undefined ? {} : { scale: options.scale }),
	}
	const preflight = preflightPngExport(assembled.value, request)
	if (preflight.decision === "blocked")
		throw new DesignPngPreflightError(preflight)
	const result = await exportPng(assembled.value, request)
	const outputs = result.artifacts.map((artifact, index) =>
		result.artifacts.length === 1
			? output
			: batchOutput(output, index, artifact.artboard.name),
	)
	for (const [index, artifact] of result.artifacts.entries())
		await writeAtomically(
			outputs[index]!,
			artifact.bytes,
			options.force === true,
		)
	return Object.freeze({
		byteLength: result.artifacts.reduce(
			(sum, artifact) => sum + artifact.bytes.byteLength,
			0,
		),
		outputs: Object.freeze(outputs),
		preflight,
		sourceRevision: snapshot.revision,
	})
}

export function formatPngDiagnostic(value: PngDiagnostic): string {
	return `${value.severity} ${value.code}${value.entityId === undefined ? "" : ` [${value.entityId}]`}: ${value.message}`
}
