import { basename, resolve } from "node:path"

import { exportDesignPdf, type DesignPdfExportResult } from "./pdf-export.ts"

export type BuildDesignProjectOptions = Readonly<{
	artboardIds?: readonly string[]
	includeBleed?: boolean
	root: string
}>

export function designBuildOutput(rootInput: string): string {
	const root = resolve(rootInput)
	const name = basename(root)
	return resolve(root, "..", "..", "artifacts", name, `${name}.pdf`)
}

export function buildDesignProject(
	options: BuildDesignProjectOptions,
): Promise<DesignPdfExportResult> {
	return exportDesignPdf({
		...options,
		force: true,
		output: designBuildOutput(options.root),
	})
}
