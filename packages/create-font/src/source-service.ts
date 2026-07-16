import {
	mkdir,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { watch } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, relative, resolve, sep } from "node:path"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
	type JsonValue,
	type SourceManifest,
	type SourceChangedEvent,
	type SourceUnitSnapshot,
	type CreateFontSourceService,
	type WriteSourceUnitInput,
	type WriteSourceUnitsInput,
	type WriteSourceUnitsResult,
} from "@create-font/server"
import {
	assembleEditorFontSource,
	formatSourceUnit,
	parseSourceUnitText,
	sourceUnitKindForPath,
	type FontSourceDirectoryFiles,
	type SourceDiagnostic,
} from "@create-font/source"

type LoadedProject = Readonly<{
	manifest: SourceManifest
	revisions: ReadonlyMap<string, string>
	texts: ReadonlyMap<string, string>
	values: FontSourceDirectoryFiles
}>

type TransactionEntry = Readonly<{
	existed: boolean
	path: string
}>

type TransactionJournal = Readonly<{
	entries: readonly TransactionEntry[]
}>

function revisionForText(text: string): string {
	return `sha256:${createHash(`sha256`).update(text).digest(`hex`)}`
}

function manifestRevision(
	units: readonly { readonly path: string; readonly revision: string }[],
): string {
	return revisionForText(
		units.map((unit) => `${unit.path}\0${unit.revision}\n`).join(``),
	)
}

function asValidationIssues(
	errors: readonly [SourceDiagnostic, ...SourceDiagnostic[]],
) {
	return errors.map(({ code, message, path, unitPath }) => ({
		code,
		message,
		path,
		...(unitPath === undefined ? {} : { unitPath }),
	})) as [
		{
			code: string
			message: string
			path: string
			unitPath?: string
		},
		...{
			code: string
			message: string
			path: string
			unitPath?: string
		}[],
	]
}

function validationError(
	errors: readonly [SourceDiagnostic, ...SourceDiagnostic[]],
): SourceValidationError {
	return new SourceValidationError(asValidationIssues(errors))
}

function normalizeUnitPath(path: string): string {
	if (
		path.length === 0 ||
		path.includes(`\0`) ||
		path.includes(`\\`) ||
		path.startsWith(`/`)
	) {
		throw new SourceUnitNotFoundError(path)
	}
	const segments = path.split(`/`)
	if (
		segments.some(
			(segment) => segment.length === 0 || segment === `.` || segment === `..`,
		)
	) {
		throw new SourceUnitNotFoundError(path)
	}
	return segments.join(`/`)
}

async function collectJsonPaths(
	root: string,
	directory = root,
): Promise<readonly string[]> {
	const paths: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === `.create-font`) continue
		const absolute = join(directory, entry.name)
		if (entry.isSymbolicLink()) {
			throw new Error(`Font source cannot contain symbolic links: ${absolute}`)
		}
		if (entry.isDirectory()) {
			paths.push(...(await collectJsonPaths(root, absolute)))
			continue
		}
		if (!entry.isFile() || !entry.name.endsWith(`.json`)) continue
		paths.push(relative(root, absolute).split(sep).join(`/`))
	}
	return paths.toSorted()
}

async function collectDirectories(
	directory: string,
): Promise<readonly string[]> {
	const directories = [directory]
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === `.create-font` || !entry.isDirectory()) continue
		directories.push(...(await collectDirectories(join(directory, entry.name))))
	}
	return directories
}

function resolveInside(root: string, path: string): string {
	const normalized = normalizeUnitPath(path)
	const absolute = resolve(root, normalized)
	const relativePath = relative(root, absolute)
	if (
		relativePath === `` ||
		relativePath === `..` ||
		relativePath.startsWith(`..${sep}`) ||
		relativePath.includes(`\0`)
	) {
		throw new SourceUnitNotFoundError(path)
	}
	return absolute
}

async function pathExists(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined)) !== undefined
}

async function rollbackTransaction(
	projectRoot: string,
	transactionRoot: string,
	journal: TransactionJournal,
): Promise<void> {
	for (const entry of journal.entries.toReversed()) {
		const target = resolveInside(projectRoot, entry.path)
		const backup = join(transactionRoot, `backup`, entry.path)
		const staged = join(transactionRoot, `staged`, entry.path)
		if (await pathExists(backup)) {
			await rm(target, { force: true })
			await mkdir(dirname(target), { recursive: true })
			await rename(backup, target)
		} else if (!entry.existed && !(await pathExists(staged))) {
			await rm(target, { force: true })
		}
	}
	await rm(transactionRoot, { force: true, recursive: true })
}

async function recoverTransactions(projectRoot: string): Promise<void> {
	const transactionsRoot = join(projectRoot, `.create-font`, `transactions`)
	const entries = await readdir(transactionsRoot, {
		withFileTypes: true,
	}).catch(() => [])
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		const transactionRoot = join(transactionsRoot, entry.name)
		const journal = await readFile(
			join(transactionRoot, `transaction.json`),
			`utf8`,
		)
			.then((text) => JSON.parse(text) as TransactionJournal)
			.catch(() => undefined)
		if (journal === undefined) {
			await rm(transactionRoot, { force: true, recursive: true })
			continue
		}
		await rollbackTransaction(projectRoot, transactionRoot, journal)
	}
}

export async function createFileSystemSourceService(
	projectRootInput: string,
): Promise<CreateFontSourceService> {
	const projectRoot = await realpath(resolve(projectRootInput))
	await recoverTransactions(projectRoot)

	let tail: Promise<void> = Promise.resolve()
	const withLock = <Value>(operation: () => Promise<Value>): Promise<Value> => {
		const result = tail.then(operation, operation)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const idempotentWrites = new Map<
		string,
		Readonly<{ fingerprint: string; result: WriteSourceUnitsResult }>
	>()
	const sourceListeners = new Set<(event: SourceChangedEvent) => void>()
	let publishedRevision: string | null = null

	const loadProject = async (): Promise<LoadedProject> => {
		const values: Record<string, unknown> = {}
		const revisions = new Map<string, string>()
		const texts = new Map<string, string>()
		const paths = await collectJsonPaths(projectRoot)
		for (const path of paths) {
			const kind = sourceUnitKindForPath(path)
			if (kind === null) {
				throw validationError([
					{
						severity: `error`,
						code: `directory.unknown_file`,
						unitPath: path,
						path: `$`,
						message: `Source unit ${JSON.stringify(path)} is not part of the create-font directory contract.`,
					},
				])
			}
			const absolute = resolveInside(projectRoot, path)
			const canonical = await realpath(absolute)
			if (
				canonical !== absolute &&
				relative(projectRoot, canonical).startsWith(`..`)
			) {
				throw new Error(`Source unit escapes its font project: ${path}`)
			}
			const text = await readFile(absolute, `utf8`)
			const parsed = parseSourceUnitText(kind, text, path)
			if (!parsed.ok) throw validationError(parsed.errors)
			values[path] = parsed.value
			texts.set(path, text)
			revisions.set(path, revisionForText(text))
		}
		const assembled = assembleEditorFontSource(values)
		if (!assembled.ok) throw validationError(assembled.errors)
		const units = paths.map((path) => ({
			path,
			revision: revisions.get(path) ?? revisionForText(``),
		}))
		return {
			manifest: {
				revision: manifestRevision(units),
				units,
			},
			revisions,
			texts,
			values,
		}
	}

	const snapshot = (
		project: LoadedProject,
		path: string,
	): SourceUnitSnapshot => {
		const value = project.values[path]
		const revision = project.revisions.get(path)
		if (value === undefined || revision === undefined) {
			throw new SourceUnitNotFoundError(path)
		}
		return { path, revision, value: value as JsonValue }
	}

	const writeUnitsUnlocked = async (
		input: WriteSourceUnitsInput,
	): Promise<WriteSourceUnitsResult> => {
		const fingerprint = JSON.stringify(input.writes)
		const previous = idempotentWrites.get(input.idempotencyKey)
		if (previous !== undefined) {
			if (previous.fingerprint !== fingerprint) {
				throw new Error(
					`Idempotency key ${input.idempotencyKey} was reused for a different write.`,
				)
			}
			return previous.result
		}

		const project = await loadProject()
		const paths = new Set<string>()
		const formatted = new Map<string, string>()
		const candidate = { ...project.values }
		for (const write of input.writes) {
			const path = normalizeUnitPath(write.path)
			if (paths.has(path)) {
				throw new Error(`Source unit ${path} is written more than once.`)
			}
			paths.add(path)
			const actualRevision = project.revisions.get(path) ?? null
			if (write.expectedRevision !== actualRevision) {
				throw new SourceUnitConflictError(
					path,
					write.expectedRevision,
					actualRevision,
				)
			}
			const kind = sourceUnitKindForPath(path)
			if (kind === null) throw new SourceUnitNotFoundError(path)
			const result = formatSourceUnit(kind, write.value, path)
			if (!result.ok) throw validationError(result.errors)
			candidate[path] = write.value
			formatted.set(path, result.value)
		}
		const assembled = assembleEditorFontSource(candidate)
		if (!assembled.ok) throw validationError(assembled.errors)

		const transactionRoot = join(
			projectRoot,
			`.create-font`,
			`transactions`,
			randomUUID(),
		)
		const entries: TransactionEntry[] = []
		for (const write of input.writes) {
			const path = normalizeUnitPath(write.path)
			const staged = join(transactionRoot, `staged`, path)
			await mkdir(dirname(staged), { recursive: true })
			await writeFile(staged, formatted.get(path) ?? ``)
			entries.push({
				existed: project.revisions.has(path),
				path,
			})
		}
		const journal: TransactionJournal = { entries }
		await writeFile(
			join(transactionRoot, `transaction.json`),
			`${JSON.stringify(journal, null, "\t")}\n`,
		)

		try {
			for (const entry of entries) {
				const target = resolveInside(projectRoot, entry.path)
				const staged = join(transactionRoot, `staged`, entry.path)
				if (entry.existed) {
					const backup = join(transactionRoot, `backup`, entry.path)
					await mkdir(dirname(backup), { recursive: true })
					await rename(target, backup)
				}
				await mkdir(dirname(target), { recursive: true })
				await rename(staged, target)
			}
			await rm(transactionRoot, { force: true, recursive: true })
		} catch (error) {
			await rollbackTransaction(projectRoot, transactionRoot, journal)
			throw error
		}

		const updated = await loadProject()
		const units = input.writes.map((write) =>
			snapshot(updated, normalizeUnitPath(write.path)),
		) as unknown as readonly [SourceUnitSnapshot, ...SourceUnitSnapshot[]]
		const result = {
			revision: updated.manifest.revision,
			units,
		}
		idempotentWrites.set(input.idempotencyKey, { fingerprint, result })
		return result
	}

	const publishManifest = (manifest: SourceManifest): void => {
		if (manifest.revision === publishedRevision) return
		publishedRevision = manifest.revision
		const event: SourceChangedEvent = {
			type: `source.changed`,
			manifest,
		}
		for (const listener of sourceListeners) listener(event)
	}

	publishedRevision = (await loadProject()).manifest.revision
	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const scheduleRefresh = (): void => {
		if (refreshTimer !== undefined) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined
			void withLock(async () => {
				publishManifest((await loadProject()).manifest)
			}).catch(() => undefined)
		}, 50)
	}
	const watchers = (await collectDirectories(projectRoot)).map((directory) =>
		watch(directory, scheduleRefresh),
	)
	for (const watcher of watchers) watcher.unref()

	return {
		readManifest: () => withLock(async () => (await loadProject()).manifest),
		readUnit: (path) =>
			withLock(async () =>
				snapshot(await loadProject(), normalizeUnitPath(path)),
			),
		writeUnit: (input: WriteSourceUnitInput) =>
			withLock(async () => {
				const result = await writeUnitsUnlocked({
					idempotencyKey: input.idempotencyKey,
					writes: [
						{
							expectedRevision: input.expectedRevision,
							path: input.path,
							value: input.value,
						},
					],
				})
				const first = result.units[0]
				if (first === undefined)
					throw new Error(`Source write returned no unit.`)
				return first
			}),
		writeUnits: (input) => withLock(() => writeUnitsUnlocked(input)),
		subscribe(listener) {
			sourceListeners.add(listener)
			for (const watcher of watchers) watcher.ref()
			return () => {
				sourceListeners.delete(listener)
				if (sourceListeners.size === 0) {
					for (const watcher of watchers) watcher.unref()
				}
			}
		},
	}
}
