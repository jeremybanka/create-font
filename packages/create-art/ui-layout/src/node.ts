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
import { basename, dirname, join, parse, resolve, sep } from "node:path"

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
	readonly expected: string | null
	readonly actual: string | null

	constructor(expected: string | null, actual: string | null) {
		super(
			"The UI layout file changed since it was loaded. Reload before saving.",
		)
		this.expected = expected
		this.actual = actual
	}
}

function revision(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`
}
function issuePath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : `$.${path.map(String).join(".")}`
}
function pathResolutionError(
	path: string,
	error: NodeJS.ErrnoException,
): Error {
	if (error.code === "ELOOP")
		return new Error(`UI layout path has a cyclic symbolic link: ${path}`)
	if (error.code === "ENOENT")
		return new Error(`UI layout path contains a broken symbolic link: ${path}`)
	if (error.code === "EACCES" || error.code === "EPERM")
		return new Error(`UI layout path is unreadable: ${path}`)
	return new Error(`Could not resolve UI layout path ${path}: ${error.message}`)
}

/**
 * Walk the logical path without rejecting links. A missing ordinary component is
 * a valid not-yet-created layout location; a link must always resolve cleanly.
 */
async function assertResolvableSymlinks(path: string): Promise<void> {
	const absolute = resolve(path)
	const root = parse(absolute).root
	const parts = absolute.slice(root.length).split(sep).filter(Boolean)
	let current = root
	for (const part of parts) {
		current = join(current, part)
		let info
		try {
			info = await lstat(current)
		} catch (error) {
			const io = error as NodeJS.ErrnoException
			if (io.code === "ENOENT") return
			throw pathResolutionError(current, io)
		}
		if (!info.isSymbolicLink()) continue
		try {
			await realpath(current)
		} catch (error) {
			throw pathResolutionError(current, error as NodeJS.ErrnoException)
		}
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
	const assertPath = (
		path: string,
		product: UiLayoutProduct,
		origin: UiLayoutOrigin,
	): void => {
		if (path !== pathFor(product, origin))
			throw new Error("UI layout path is not an exact supported location.")
	}
	const readSource = async (
		product: UiLayoutProduct,
		origin: UiLayoutOrigin,
	): Promise<UiLayoutSource> => {
		const path = pathFor(product, origin)
		assertPath(path, product, origin)
		await assertResolvableSymlinks(path)
		const text = await readFile(path, "utf8").catch(
			async (error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") {
					// Distinguish a normal absent layout from a link that broke after
					// the first check.
					await assertResolvableSymlinks(path)
					return null
				}
				if (
					error.code === "ELOOP" ||
					error.code === "EACCES" ||
					error.code === "EPERM"
				)
					throw pathResolutionError(path, error)
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
		assertPath(path, input.product, input.origin)
		await assertResolvableSymlinks(path)
		try {
			await mkdir(dirname(path), { recursive: true })
		} catch (error) {
			throw pathResolutionError(dirname(path), error as NodeJS.ErrnoException)
		}
		// Resolve again immediately before writing. Directory links are followed
		// into their canonical directory. A final ui.json link is deliberately
		// preserved by replacing its canonical target rather than the link itself.
		await assertResolvableSymlinks(path)
		let canonicalParent: string
		try {
			canonicalParent = await realpath(dirname(path))
		} catch (error) {
			throw pathResolutionError(dirname(path), error as NodeJS.ErrnoException)
		}
		let target = join(canonicalParent, basename(path))
		const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null
			throw pathResolutionError(path, error)
		})
		if (info?.isSymbolicLink()) {
			try {
				target = await realpath(path)
			} catch (error) {
				throw pathResolutionError(path, error as NodeJS.ErrnoException)
			}
		}
		let targetParent: string
		try {
			targetParent = await realpath(dirname(target))
		} catch (error) {
			throw pathResolutionError(dirname(target), error as NodeJS.ErrnoException)
		}
		target = join(targetParent, basename(target))
		const temporary = join(targetParent, `.ui.json.${randomUUID()}.tmp`)
		const handle = await open(
			temporary,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
			0o600,
		)
		try {
			await handle.writeFile(text, "utf8")
			await handle.sync()
			await handle.close()
			await rename(temporary, target)
		} catch (error) {
			await handle.close().catch(() => undefined)
			await rm(temporary, { force: true }).catch(() => undefined)
			throw error
		}
		return load(input.product)
	}
	return { load, pathFor, readSource, save }
}
