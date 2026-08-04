import {
	exportSvg,
	preflightSvgExport,
	svgPreflightAllowsOutput,
	type SvgExportTarget,
	type SvgPreflightResult,
} from "@create-design/svg"
import type { DesignDocument } from "./types.ts"

export interface SvgDownloadEnvironment {
	readonly activate: (url: string, filename: string) => void
	readonly createObjectURL: (blob: Blob) => string
	readonly revokeObjectURL: (url: string) => void
	readonly serialize?: (
		document: DesignDocument,
		target: SvgExportTarget,
	) => Promise<Uint8Array> | Uint8Array
}

export function browserSvgDownloadEnvironment(): SvgDownloadEnvironment {
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

export function createSvgDownloadManager(
	environment: SvgDownloadEnvironment = browserSvgDownloadEnvironment(),
) {
	const serialize = environment.serialize ?? exportSvg
	let generation = 0
	let disposed = false
	return {
		dispose(): void {
			disposed = true
			generation++
		},
		preflight(
			document: DesignDocument,
			target: SvgExportTarget,
		): SvgPreflightResult {
			return preflightSvgExport(document, target)
		},
		async request(
			document: DesignDocument,
			target: SvgExportTarget,
		): Promise<boolean> {
			if (disposed) return false
			const currentGeneration = ++generation
			if (!svgPreflightAllowsOutput(preflightSvgExport(document, target)))
				return false
			let bytes: Uint8Array
			try {
				bytes = await serialize(document, target)
			} catch (error) {
				if (disposed || currentGeneration !== generation) return false
				throw error
			}
			if (disposed || currentGeneration !== generation) return false
			const url = environment.createObjectURL(
				new Blob([new Uint8Array(bytes).buffer], { type: "image/svg+xml" }),
			)
			if (disposed || currentGeneration !== generation) {
				environment.revokeObjectURL(url)
				return false
			}
			environment.activate(url, `${document.title.trim() || "untitled"}.svg`)
			setTimeout(() => environment.revokeObjectURL(url), 0)
			return true
		},
	}
}
