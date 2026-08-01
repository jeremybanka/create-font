import { exportPdf, type PdfExportTarget } from "./pdf.ts"
import type { DesignDocument } from "./types.ts"

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
) {
	const serialize = environment.serialize ?? exportPdf
	let generation = 0
	let disposed = false

	return {
		dispose(): void {
			disposed = true
			generation++
		},
		async request(
			document: DesignDocument,
			target: PdfExportTarget,
		): Promise<boolean> {
			if (disposed) return false
			const currentGeneration = ++generation
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
