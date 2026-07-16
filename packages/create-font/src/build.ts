import { stat } from "node:fs/promises"
import { resolve } from "node:path"

import type { BuildResult } from "@create-font/server"

export type { BuildDiagnostic, BuildResult } from "@create-font/server"

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
				message: `The create-font project source loader and binary serializer have not been implemented yet.`,
				path: root,
				severity: `error`,
			},
		],
	}
}
