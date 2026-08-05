import { resolve } from "node:path"

import { SourceValidationError } from "@create-art/source-rpc"

import { createDesignSourceService } from "./source-service.ts"

export type DesignCheckDiagnostic = Readonly<{
	code: string
	message: string
	path: string
	severity: "error"
}>

export type DesignCheckResult = Readonly<{
	diagnostics: readonly DesignCheckDiagnostic[]
	ok: boolean
	root: string
}>

export async function checkDesignProject(
	rootInput: string,
): Promise<DesignCheckResult> {
	const root = resolve(rootInput)
	try {
		const source = await createDesignSourceService(root, { initialize: false })
		await source.readSnapshot()
		return { diagnostics: [], ok: true, root }
	} catch (error) {
		if (error instanceof SourceValidationError)
			return {
				diagnostics: error.issues.map((issue) => ({
					code: issue.code,
					message: issue.message,
					path: issue.unitPath ?? issue.path,
					severity: "error",
				})),
				ok: false,
				root,
			}
		return {
			diagnostics: [
				{
					code: "check.failed",
					message: error instanceof Error ? error.message : String(error),
					path: root,
					severity: "error",
				},
			],
			ok: false,
			root,
		}
	}
}

export function formatStylishCheck(result: DesignCheckResult): string {
	if (result.diagnostics.length === 0) return "No source diagnostics found."
	return [
		...result.diagnostics.map(
			(diagnostic) =>
				`${diagnostic.path}  ${diagnostic.severity} ${diagnostic.code}\n  ${diagnostic.message}`,
		),
		`${result.diagnostics.length} ${result.diagnostics.length === 1 ? "error" : "errors"}`,
	].join("\n\n")
}
