import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

import type {
	SaveUiLayoutInput,
	UiLayoutDiagnostic,
	UiLayoutsResponse,
	UiLayoutSource,
} from "./contracts.ts"
import {
	prettyUiLayoutFile,
	type UiLayoutFileV1,
	type UiLayoutOrigin,
	type UiLayoutProduct,
	type UiLayoutRecordV1,
	uiLayoutFileV1Schema,
	uiLayoutRecordV1Schema,
} from "./schema.ts"

export class UiLayoutConflictError extends Error {
	constructor(
		readonly expected: string | null,
		readonly actual: string | null,
	) {
		super(
			"The UI layout file changed since it was loaded. Reload before saving.",
		)
	}
}

function revision(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`
}
function issuePath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : `$.${path.map(String).join(".")}`
}
async function rejectSymlinks(
	path: string,
	allowedRoot: string,
): Promise<void> {
	const relative = path.slice(allowedRoot.length).split(sep).filter(Boolean)
	let current = allowedRoot
	for (const part of relative) {
		current = join(current, part)
		const info = await lstat(current).catch(() => undefined)
		if (info?.isSymbolicLink())
			throw new Error(`UI layout path contains a symbolic link: ${current}`)
	}
}

export type UiLayoutFileServiceOptions = Readonly<{
	root: string
	home?: string
}>
export function createUiLayoutFileService(options: UiLayoutFileServiceOptions) {
	const workspaceRoot = resolve(options.root)
	const homeRoot = resolve(options.home ?? homedir())
	const pathFor = (
		product: UiLayoutProduct,
		origin: UiLayoutOrigin,
	): string => {
		if (origin === "home") return join(homeRoot, ".config", product, "ui.json")
		return join(
			workspaceRoot,
			product === "create-font" ? "fonts" : "designs",
			"ui.json",
		)
	}
	const assertPath = async (
		path: string,
		origin: UiLayoutOrigin,
	): Promise<void> => {
		const allowed = origin === "home" ? homeRoot : workspaceRoot
		if (path !== allowed && !path.startsWith(`${allowed}${sep}`))
			throw new Error("UI layout path escaped its allowlisted root.")
		await rejectSymlinks(path, allowed)
		const realAllowed = await realpath(allowed).catch(() => allowed)
		const existingParent = await realpath(dirname(path)).catch(() =>
			dirname(path),
		)
		if (
			existingParent !== realAllowed &&
			!existingParent.startsWith(`${realAllowed}${sep}`)
		)
			throw new Error(
				"UI layout path escaped its allowlisted root through a symbolic link.",
			)
	}
	const readSource = async (
		product: UiLayoutProduct,
		origin: UiLayoutOrigin,
	): Promise<UiLayoutSource> => {
		const path = pathFor(product, origin)
		await assertPath(path, origin)
		const text = await readFile(path, "utf8").catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return null
				throw error
			},
		)
		if (text === null)
			return { origin, revision: null, layouts: [], issues: [] }
		let value: unknown
		try {
			value = JSON.parse(text)
		} catch (error) {
			return {
				origin,
				revision: revision(text),
				layouts: [],
				issues: [
					{
						file: path,
						path: "$",
						message: error instanceof Error ? error.message : "Invalid JSON.",
					},
				],
			}
		}
		if (!Array.isArray(value))
			return {
				origin,
				revision: revision(text),
				layouts: [],
				issues: [
					{
						file: path,
						path: "$",
						message: "Expected an array of UI layouts.",
					},
				],
			}
		const layouts: UiLayoutFileV1[number][] = []
		const issues: UiLayoutDiagnostic[] = []
		for (const [index, item] of value.entries()) {
			const result = uiLayoutRecordV1Schema.safeParse(item)
			if (result.success && result.data.product === product)
				layouts.push(result.data)
			else if (!result.success)
				for (const issue of result.error.issues)
					issues.push({
						file: path,
						record: index,
						path: issuePath([index, ...issue.path]),
						message: issue.message,
					})
			else
				issues.push({
					file: path,
					record: index,
					path: `$[${index}].product`,
					message: `Expected ${product}, received ${result.data.product}.`,
				})
		}
		const whole = uiLayoutFileV1Schema.safeParse(layouts)
		if (!whole.success)
			for (const issue of whole.error.issues)
				issues.push({
					file: path,
					path: issuePath(issue.path),
					message: issue.message,
					...(typeof issue.path[0] === "number"
						? { record: issue.path[0] }
						: {}),
				})
		return { origin, revision: revision(text), layouts, issues }
	}
	const load = async (
		product: UiLayoutProduct,
	): Promise<UiLayoutsResponse> => ({
		sources: await Promise.all(
			(["home", "project"] as const).map((origin) =>
				readSource(product, origin),
			),
		),
	})
	const save = async (input: SaveUiLayoutInput): Promise<UiLayoutsResponse> => {
		const parsed = uiLayoutRecordV1Schema.parse(input.layout)
		if (parsed.product !== input.product)
			throw new Error("Layout product does not match the requested product.")
		const source = await readSource(input.product, input.origin)
		if (source.revision !== input.expectedRevision)
			throw new UiLayoutConflictError(input.expectedRevision, source.revision)
		if (source.issues.length > 0)
			throw new Error(
				"Fix validation errors in the destination UI layout file before saving.",
			)
		const records: UiLayoutRecordV1[] = [...source.layouts]
		const index = records.findIndex(({ id }) => id === parsed.id)
		if (index < 0) records.push(parsed)
		else records[index] = parsed
		records.sort((a, b) => a.id.localeCompare(b.id))
		const text = prettyUiLayoutFile(uiLayoutFileV1Schema.parse(records))
		const path = pathFor(input.product, input.origin)
		await assertPath(path, input.origin)
		await mkdir(dirname(path), { recursive: true })
		await assertPath(path, input.origin)
		const temporary = join(dirname(path), `.ui.json.${randomUUID()}.tmp`)
		const handle = await open(
			temporary,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
			0o600,
		)
		try {
			await handle.writeFile(text, "utf8")
			await handle.sync()
			await handle.close()
			await rename(temporary, path)
		} catch (error) {
			await handle.close().catch(() => undefined)
			await rm(temporary, { force: true }).catch(() => undefined)
			throw error
		}
		return load(input.product)
	}
	return { load, pathFor, readSource, save }
}
