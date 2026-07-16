import { stat } from "node:fs/promises"
import { resolve } from "node:path"

export type BuildDiagnostic = Readonly<{
	code: `build.not_implemented` | `workspace.not_directory`
	message: string
	path: string
	severity: `error`
}>

export type BuildResult =
	| Readonly<{
			ok: true
			root: string
			outputs: readonly string[]
	  }>
	| Readonly<{
			ok: false
			root: string
			errors: readonly [BuildDiagnostic, ...BuildDiagnostic[]]
	  }>

export async function buildProject(
	rootInput: string = process.cwd(),
): Promise<BuildResult> {
	const root = resolve(rootInput)
	const rootStats = await stat(root).catch(() => undefined)

	if (!rootStats?.isDirectory()) {
		return {
			ok: false,
			root,
			errors: [
				{
					code: `workspace.not_directory`,
					message: `The workspace root is not a readable directory.`,
					path: root,
					severity: `error`,
				},
			],
		}
	}

	return {
		ok: false,
		root,
		errors: [
			{
				code: `build.not_implemented`,
				message: `The Trigraph project source loader and binary serializer have not been implemented yet.`,
				path: root,
				severity: `error`,
			},
		],
	}
}
