import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

import {
	SourceValidationError,
	type BuildDiagnostic,
	type BuildResult,
} from "@create-font/server"
import {
	createFontEditorState,
	type FontCompilation,
} from "@create-font/states"
import { serializeVariableFont } from "@create-font/target"

import { loadEditorFontSourceDirectory } from "./source-service.ts"

export type { BuildDiagnostic, BuildResult } from "@create-font/server"

function failure(
	root: string,
	errors: readonly BuildDiagnostic[],
): BuildResult {
	if (errors.length === 0) throw new Error(`A failed build needs a diagnostic.`)
	return {
		ok: false,
		root,
		errors: errors as [BuildDiagnostic, ...BuildDiagnostic[]],
	}
}

function outputPath(root: string, postScriptName: string): string {
	return resolve(
		root,
		`..`,
		`..`,
		`artifacts`,
		basename(root),
		`${postScriptName}.ttf`,
	)
}

export async function buildProject(
	rootInput: string = process.cwd(),
): Promise<BuildResult> {
	const root = resolve(rootInput)
	const rootStats = await stat(root).catch(() => undefined)

	if (!rootStats?.isDirectory()) {
		return failure(root, [
			{
				code: `workspace.not_directory`,
				message: `The workspace root is not a readable directory.`,
				path: root,
				severity: `error`,
			},
		])
	}

	let source
	try {
		source = await loadEditorFontSourceDirectory(root)
	} catch (error) {
		if (error instanceof SourceValidationError) {
			return failure(
				root,
				error.issues.map((issue) => ({
					code: issue.code,
					message: issue.message,
					path: issue.path,
					severity: `error`,
					...(issue.unitPath === undefined ? {} : { unitPath: issue.unitPath }),
				})),
			)
		}
		return failure(root, [
			{
				code: `source.read_failed`,
				message: error instanceof Error ? error.message : String(error),
				path: root,
				severity: `error`,
			},
		])
	}

	let compilation: FontCompilation
	try {
		const state = createFontEditorState({
			key: `create-font/build/${randomUUID()}`,
		})
		state.actions.load(source)
		compilation = state.read.compilation()
	} catch (error) {
		return failure(root, [
			{
				code: `build.projection_failed`,
				message: error instanceof Error ? error.message : String(error),
				path: `$`,
				severity: `error`,
			},
		])
	}
	if (!compilation.ok) {
		if (compilation.stage === `projection-failed`) {
			return failure(
				root,
				compilation.projectionErrors.map((issue) => ({
					code: issue.code,
					message: issue.message,
					path: issue.path,
					severity: `error`,
					...(issue.entityId === undefined ? {} : { entityId: issue.entityId }),
				})),
			)
		}
		return failure(
			root,
			compilation.ingestionErrors.map((issue) => ({
				code: issue.code,
				message: issue.message,
				path: issue.path,
				severity: `error`,
				table: issue.table,
			})),
		)
	}

	let bytes: Uint8Array
	try {
		bytes = serializeVariableFont(compilation.font)
	} catch (error) {
		return failure(root, [
			{
				code: `build.serialization_failed`,
				message: error instanceof Error ? error.message : String(error),
				path: `$`,
				severity: `error`,
			},
		])
	}

	const output = outputPath(root, String(compilation.font.names.postScriptName))
	const temporary = resolve(
		dirname(output),
		`.${basename(output)}.${randomUUID()}.tmp`,
	)
	try {
		await mkdir(dirname(output), { recursive: true })
		await writeFile(temporary, bytes, { flag: `wx` })
		await rename(temporary, output)
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined)
		return failure(root, [
			{
				code: `build.output_failed`,
				message: error instanceof Error ? error.message : String(error),
				path: output,
				severity: `error`,
			},
		])
	}

	return { ok: true, root, outputs: [output] }
}
