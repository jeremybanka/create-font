import { exportPdf, type PdfExportTarget } from "@create-design/pdf"
import type { DesignTextService } from "@create-design/text"
import {
	exportPreflightAllowsOutput,
	type ExportPreflightPreferences,
	type ExportPreflightResult,
} from "@create-design/pdf"
import { preflightPdfExport } from "@create-design/pdf"
import type { DesignDocument, DesignImageResource } from "./types.ts"

export interface PdfDownloadEnvironment {
	readonly activate: (url: string, filename: string) => void
	readonly createObjectURL: (blob: Blob) => string
	readonly revokeObjectURL: (url: string) => void
	readonly serialize?: (
		document: DesignDocument,
		target: PdfExportTarget,
	) => Promise<Uint8Array> | Uint8Array
}

export function browserPdfDownloadEnvironment(): PdfDownloadEnvironment {
	return {
		activate(url, filename) {
			const anchor = window.document.createElement("a")
			anchor.href = url
			anchor.download = filename
			anchor.click()
		},
		createObjectURL: (blob) => URL.createObjectURL(blob),
		revokeObjectURL: (url) => URL.revokeObjectURL(url),
	}
}

export function createPdfDownloadManager(
	environment: PdfDownloadEnvironment = browserPdfDownloadEnvironment(),
	options: Readonly<{
		textService?: DesignTextService
		imageResources?: ReadonlyMap<string, DesignImageResource>
	}> = {},
) {
	const serialize =
		environment.serialize ??
		((document: DesignDocument, target: PdfExportTarget) =>
			exportPdf(document, target, {
				...(options.textService === undefined
					? {}
					: { textService: options.textService }),
				...(options.imageResources === undefined
					? {}
					: { imageResources: options.imageResources }),
			}))
	let generation = 0
	let disposed = false

	return {
		dispose(): void {
			disposed = true
			generation++
		},
		preflight(
			document: DesignDocument,
			target: PdfExportTarget,
			preferences: ExportPreflightPreferences = {},
		): ExportPreflightResult {
			return preflightPdfExport(
				document,
				target,
				preferences,
				options.textService,
				options.imageResources,
			)
		},
		async request(
			document: DesignDocument,
			target: PdfExportTarget,
			preferences: ExportPreflightPreferences = {},
		): Promise<boolean> {
			if (disposed) return false
			const currentGeneration = ++generation
			const preflight = preflightPdfExport(
				document,
				target,
				preferences,
				options.textService,
				options.imageResources,
			)
			if (!exportPreflightAllowsOutput(preflight)) return false
			let bytes: Uint8Array
			try {
				bytes = await serialize(document, target)
			} catch (error) {
				if (disposed || currentGeneration !== generation) return false
				throw error
			}
			if (disposed || currentGeneration !== generation) return false
			const url = environment.createObjectURL(
				new Blob([new Uint8Array(bytes).buffer], { type: "application/pdf" }),
			)
			if (disposed || currentGeneration !== generation) {
				environment.revokeObjectURL(url)
				return false
			}
			environment.activate(url, `${document.title.trim() || "untitled"}.pdf`)
			setTimeout(() => environment.revokeObjectURL(url), 0)
			return true
		},
	}
}
