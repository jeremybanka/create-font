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
	ARTWORK_OUTSIDE_ARTBOARDS_LINT,
	exportPdf,
	exportPreflightAllowsOutput,
	preflightPdfExport,
	type ExportDiagnostic,
	type ExportPreflightResult,
	type PdfExportRequest,
} from "@create-design/pdf"
import {
	assembleDesignDocument,
	fontIndexFileSchema,
	type DesignDocument,
	type DesignSourceDiagnostic,
} from "@create-design/source"
import {
	createDesignTextService,
	type DesignTextService,
} from "@create-design/text"

import { createDesignSourceService } from "./source-service.ts"

export interface DesignPdfExportOptions {
	readonly artboardIds?: readonly string[]
	readonly force?: boolean
	readonly includeBleed?: boolean
	readonly output: string
	readonly root: string
}

export interface DesignPdfExportResult {
	readonly byteLength: number
	readonly output: string
	readonly pages: number
	readonly preflight: ExportPreflightResult
	readonly sourceRevision: string
}

export class DesignPdfSourceError extends Error {
	readonly diagnostics: readonly DesignSourceDiagnostic[]

	constructor(diagnostics: readonly DesignSourceDiagnostic[]) {
		super("The create-design source project is not valid.")
		this.name = "DesignPdfSourceError"
		this.diagnostics = diagnostics
	}
}

export class DesignPdfPreflightError extends Error {
	readonly preflight: ExportPreflightResult

	constructor(preflight: ExportPreflightResult) {
		super("PDF export was blocked by preflight errors.")
		this.name = "DesignPdfPreflightError"
		this.preflight = preflight
	}
}

export class DesignPdfOutputExistsError extends Error {
	readonly output: string

	constructor(output: string) {
		super(`Output already exists: ${output}. Pass --force to replace it.`)
		this.name = "DesignPdfOutputExistsError"
		this.output = output
	}
}

function errorCode(error: unknown): string | undefined {
	return error !== null && typeof error === "object" && "code" in error
		? String(error.code)
		: undefined
}

function pathIsInside(root: string, candidate: string): boolean {
	const relativeCandidate = relative(root, candidate)
	return (
		relativeCandidate === "" ||
		(relativeCandidate !== ".." &&
			!relativeCandidate.startsWith(`..${sep}`) &&
			!isAbsolute(relativeCandidate))
	)
}

async function canonicalFuturePath(path: string): Promise<string> {
	let ancestor = dirname(path)
	const descendants = [basename(path)]
	while (true) {
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
		`PDF output must be outside the source project so generated files cannot invalidate it: ${output}`,
	)
}

async function writePdfAtomically(
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
		if (force) {
			await rename(temporary, output)
		} else {
			try {
				await link(temporary, output)
			} catch (error) {
				if (errorCode(error) === "EEXIST")
					throw new DesignPdfOutputExistsError(output)
				throw error
			}
		}
	} finally {
		await file?.close().catch(() => undefined)
		await rm(temporary, { force: true }).catch(() => undefined)
	}
}

function pdfRequest(options: DesignPdfExportOptions): PdfExportRequest {
	return {
		...(options.includeBleed === true ? { includeBleed: true } : {}),
		scope:
			options.artboardIds === undefined
				? { kind: "all" }
				: { kind: "selected", artboardIds: options.artboardIds },
	}
}

async function loadDesignDocument(root: string): Promise<{
	document: DesignDocument
	revision: string
	textService: DesignTextService
}> {
	const source = await createDesignSourceService(root, { initialize: false })
	const snapshot = await source.readSnapshot()
	const assembled = assembleDesignDocument(
		Object.fromEntries(snapshot.units.map(({ path, value }) => [path, value])),
	)
	if (!assembled.ok) throw new DesignPdfSourceError(assembled.errors)
	const textService = createDesignTextService()
	const fontIndexUnit = snapshot.units.find(
		({ path }) => path === "fonts/index.json",
	)
	const fontIndex = fontIndexFileSchema.safeParse(fontIndexUnit?.value)
	if (fontIndex.success)
		for (const entry of fontIndex.data.entries) {
			const asset = await source.readAsset(entry.path)
			const bytes = new Uint8Array(
				await new Response(asset.bytes).arrayBuffer(),
			)
			textService.registerFont(
				{
					id: entry.id,
					family: entry.family ?? entry.id.slice("font:".length),
					...(entry.faceIndex === undefined
						? {}
						: { faceIndex: entry.faceIndex }),
					revision: entry.revision ?? asset.descriptor.digest,
				},
				bytes,
			)
		}
	return {
		document: assembled.value,
		revision: snapshot.revision,
		textService,
	}
}

/** Export one validated source snapshot to an atomically published PDF file. */
export async function exportDesignPdf(
	options: DesignPdfExportOptions,
): Promise<DesignPdfExportResult> {
	const root = resolve(options.root)
	const output = resolve(options.output)
	if (extname(output).toLowerCase() !== ".pdf")
		throw new Error(`PDF output path must end in .pdf: ${output}`)
	assertOutputOutsideRoot(root, output)
	const canonicalRoot = await realpath(root)
	assertOutputOutsideRoot(canonicalRoot, await canonicalFuturePath(output))
	const { document, revision, textService } =
		await loadDesignDocument(canonicalRoot)
	const request = pdfRequest(options)
	const preflight = preflightPdfExport(
		document,
		request,
		{
			enabledLints: [ARTWORK_OUTSIDE_ARTBOARDS_LINT],
		},
		textService,
	)
	if (!exportPreflightAllowsOutput(preflight))
		throw new DesignPdfPreflightError(preflight)
	const bytes = exportPdf(document, request, { textService })
	await writePdfAtomically(output, bytes, options.force === true)
	return Object.freeze({
		byteLength: bytes.byteLength,
		output,
		pages: preflight.regions.length,
		preflight,
		sourceRevision: revision,
	})
}

export function formatExportDiagnostic(diagnostic: ExportDiagnostic): string {
	const subject = diagnostic.entityId ?? diagnostic.artboardId
	return `${diagnostic.severity} ${diagnostic.code}${subject === undefined ? "" : ` [${subject}]`}: ${diagnostic.message}`
}
