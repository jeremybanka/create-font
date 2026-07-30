import { createHash, randomUUID } from "node:crypto"
import { watch } from "node:fs"
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
import { dirname, join, relative, resolve, sep } from "node:path"

import {
	SourceUnitConflictError,
	SourceUnitNotFoundError,
	SourceValidationError,
	type JsonValue,
	type SourceChangedEvent,
	type SourceManifest,
	type SourceProjectSnapshot,
	type SourceService,
	type SourceUnitSnapshot,
	type SourceValidationIssue,
	type WriteSourceUnitInput,
	type WriteSourceUnitsInput,
	type WriteSourceUnitsResult,
} from "./contracts.ts"

type CodecResult<Value> =
	| Readonly<{ ok: true; value: Value }>
	| Readonly<{
			ok: false
			errors: readonly [SourceValidationIssue, ...SourceValidationIssue[]]
	  }>

export interface JsonSourceWorkspaceCodec<Kind = string> {
	assemble(files: Readonly<Record<string, JsonValue>>): CodecResult<unknown>
	format(kind: Kind, value: JsonValue, path: string): CodecResult<string>
	kindForPath(path: string): Kind | null
	parse(kind: Kind, text: string, path: string): CodecResult<JsonValue>
}

export type FileSystemSourceServiceOptions = Readonly<{
	controlDirectory?: string
}>

type LoadedWorkspace = Readonly<{
	manifest: SourceManifest
	revisions: ReadonlyMap<string, string>
	values: Readonly<Record<string, JsonValue>>
}>

type TransactionEntry = Readonly<{ existed: boolean; path: string }>
type TransactionJournal = Readonly<{ entries: readonly TransactionEntry[] }>

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

function resolveInside(root: string, path: string): string {
	const normalized = normalizeUnitPath(path)
	const absolute = resolve(root, normalized)
	const relativePath = relative(root, absolute)
	if (
		relativePath === `` ||
		relativePath === `..` ||
		relativePath.startsWith(`..${sep}`)
	) {
		throw new SourceUnitNotFoundError(path)
	}
	return absolute
}

async function exists(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined)) !== undefined
}

async function collectPaths(
	root: string,
	controlDirectory: string,
	directory = root,
): Promise<readonly string[]> {
	const paths: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (directory === root && entry.name === controlDirectory) continue
		const absolute = join(directory, entry.name)
		if (entry.isSymbolicLink()) {
			throw new Error(
				`Source workspaces cannot contain symbolic links: ${absolute}`,
			)
		}
		if (entry.isDirectory()) {
			paths.push(...(await collectPaths(root, controlDirectory, absolute)))
		} else if (entry.isFile()) {
			paths.push(relative(root, absolute).split(sep).join(`/`))
		}
	}
	return paths.toSorted()
}

async function collectDirectories(
	root: string,
	controlDirectory: string,
	directory = root,
): Promise<readonly string[]> {
	const directories = [directory]
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (
			!entry.isDirectory() ||
			(directory === root && entry.name === controlDirectory)
		)
			continue
		directories.push(
			...(await collectDirectories(
				root,
				controlDirectory,
				join(directory, entry.name),
			)),
		)
	}
	return directories
}

function validationError(
	errors: readonly [SourceValidationIssue, ...SourceValidationIssue[]],
): SourceValidationError {
	return new SourceValidationError(errors)
}

async function loadWorkspace<Kind>(
	root: string,
	controlDirectory: string,
	codec: JsonSourceWorkspaceCodec<Kind>,
): Promise<LoadedWorkspace> {
	const values: Record<string, JsonValue> = {}
	const revisions = new Map<string, string>()
	const paths = await collectPaths(root, controlDirectory)
	for (const path of paths) {
		const kind = codec.kindForPath(path)
		if (kind === null) {
			throw validationError([
				{
					code: `directory.unknown_file`,
					message: `Source unit ${JSON.stringify(path)} is not part of this workspace contract.`,
					path: `$`,
					unitPath: path,
				},
			])
		}
		const absolute = resolveInside(root, path)
		const canonical = await realpath(absolute)
		if (canonical !== absolute && relative(root, canonical).startsWith(`..`)) {
			throw new Error(`Source unit escapes its workspace: ${path}`)
		}
		const text = await readFile(absolute, `utf8`)
		const parsed = codec.parse(kind, text, path)
		if (!parsed.ok) throw validationError(parsed.errors)
		values[path] = parsed.value
		revisions.set(path, revisionForText(text))
	}
	const assembled = codec.assemble(values)
	if (!assembled.ok) throw validationError(assembled.errors)
	const units = paths.map((path) => ({
		path,
		revision: revisions.get(path) ?? revisionForText(``),
	}))
	return {
		manifest: { revision: manifestRevision(units), units },
		revisions,
		values,
	}
}

async function rollback(
	root: string,
	transactionRoot: string,
	journal: TransactionJournal,
): Promise<void> {
	for (const entry of journal.entries.toReversed()) {
		const target = resolveInside(root, entry.path)
		const backup = join(transactionRoot, `backup`, entry.path)
		const staged = join(transactionRoot, `staged`, entry.path)
		if (await exists(backup)) {
			await rm(target, { force: true })
			await mkdir(dirname(target), { recursive: true })
			await rename(backup, target)
		} else if (!entry.existed && !(await exists(staged))) {
			await rm(target, { force: true })
		}
	}
	await rm(transactionRoot, { force: true, recursive: true })
}

async function recover(root: string, controlDirectory: string): Promise<void> {
	const transactionsRoot = join(root, controlDirectory, `transactions`)
	for (const entry of await readdir(transactionsRoot, {
		withFileTypes: true,
	}).catch(() => [])) {
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
		} else {
			await rollback(root, transactionRoot, journal)
		}
	}
}

export async function createFileSystemSourceService<Kind>(
	rootInput: string,
	codec: JsonSourceWorkspaceCodec<Kind>,
	options: FileSystemSourceServiceOptions = {},
): Promise<SourceService> {
	const root = await realpath(resolve(rootInput))
	const controlDirectory = options.controlDirectory ?? `.create-art`
	await recover(root, controlDirectory)
	let published = await loadWorkspace(root, controlDirectory, codec)
	let tail: Promise<void> = Promise.resolve()
	const withLock = <Value>(operation: () => Promise<Value>): Promise<Value> => {
		const result = tail.then(operation, operation)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const listeners = new Set<(event: SourceChangedEvent) => void>()
	const idempotent = new Map<
		string,
		Readonly<{ fingerprint: string; result: WriteSourceUnitsResult }>
	>()
	const snapshot = (
		workspace: LoadedWorkspace,
		path: string,
	): SourceUnitSnapshot => {
		const value = workspace.values[path]
		const revision = workspace.revisions.get(path)
		if (value === undefined || revision === undefined) {
			throw new SourceUnitNotFoundError(path)
		}
		return { path, revision, value }
	}
	const projectSnapshot = (
		workspace: LoadedWorkspace,
	): SourceProjectSnapshot => ({
		revision: workspace.manifest.revision,
		units: workspace.manifest.units.map(({ path }) =>
			snapshot(workspace, path),
		),
	})
	const publish = (next: LoadedWorkspace, operationId?: string): void => {
		if (next.manifest.revision === published.manifest.revision) return
		const previous = published
		const nextPaths = new Set(next.manifest.units.map(({ path }) => path))
		const event: SourceChangedEvent = {
			type: `source.changed`,
			...(operationId === undefined ? {} : { operationId }),
			previousRevision: previous.manifest.revision,
			removedPaths: previous.manifest.units
				.map(({ path }) => path)
				.filter((path) => !nextPaths.has(path)),
			revision: next.manifest.revision,
			units: next.manifest.units
				.filter(
					({ path, revision }) => previous.revisions.get(path) !== revision,
				)
				.map(({ path }) => snapshot(next, path)),
		}
		published = next
		for (const listener of listeners) listener(event)
	}
	const writeUnitsUnlocked = async (
		input: WriteSourceUnitsInput,
	): Promise<WriteSourceUnitsResult> => {
		const removals = input.removals ?? []
		if (input.writes.length + removals.length === 0) {
			throw new Error(`A source transaction cannot be empty.`)
		}
		const fingerprint = JSON.stringify({ removals, writes: input.writes })
		const previousResult = idempotent.get(input.idempotencyKey)
		if (previousResult !== undefined) {
			if (previousResult.fingerprint !== fingerprint) {
				throw new Error(
					`Idempotency key ${input.idempotencyKey} was reused for a different transaction.`,
				)
			}
			return previousResult.result
		}
		const current = await loadWorkspace(root, controlDirectory, codec)
		const candidate: Record<string, JsonValue> = { ...current.values }
		const paths = new Set<string>()
		const formatted = new Map<string, string>()
		for (const write of input.writes) {
			const path = normalizeUnitPath(write.path)
			if (paths.has(path)) throw new Error(`Duplicate source unit ${path}.`)
			paths.add(path)
			const actual = current.revisions.get(path) ?? null
			if (actual !== write.expectedRevision) {
				throw new SourceUnitConflictError(path, write.expectedRevision, actual)
			}
			const kind = codec.kindForPath(path)
			if (kind === null) throw new SourceUnitNotFoundError(path)
			const result = codec.format(kind, write.value, path)
			if (!result.ok) throw validationError(result.errors)
			candidate[path] = write.value
			formatted.set(path, result.value)
		}
		for (const removal of removals) {
			const path = normalizeUnitPath(removal.path)
			if (paths.has(path)) throw new Error(`Duplicate source unit ${path}.`)
			paths.add(path)
			const actual = current.revisions.get(path) ?? null
			if (actual !== removal.expectedRevision) {
				throw new SourceUnitConflictError(
					path,
					removal.expectedRevision,
					actual,
				)
			}
			delete candidate[path]
		}
		const assembled = codec.assemble(candidate)
		if (!assembled.ok) throw validationError(assembled.errors)

		const transactionRoot = join(
			root,
			controlDirectory,
			`transactions`,
			randomUUID(),
		)
		const entries: TransactionEntry[] = []
		for (const write of input.writes) {
			const path = normalizeUnitPath(write.path)
			const staged = join(transactionRoot, `staged`, path)
			await mkdir(dirname(staged), { recursive: true })
			await writeFile(staged, formatted.get(path) ?? ``)
			entries.push({ existed: current.revisions.has(path), path })
		}
		for (const removal of removals) {
			entries.push({ existed: true, path: normalizeUnitPath(removal.path) })
		}
		const journal: TransactionJournal = { entries }
		await mkdir(transactionRoot, { recursive: true })
		await writeFile(
			join(transactionRoot, `transaction.json`),
			`${JSON.stringify(journal, null, "\t")}\n`,
		)
		try {
			for (const entry of entries) {
				const target = resolveInside(root, entry.path)
				const staged = join(transactionRoot, `staged`, entry.path)
				if (entry.existed) {
					const backup = join(transactionRoot, `backup`, entry.path)
					await mkdir(dirname(backup), { recursive: true })
					await rename(target, backup)
				}
				if (await exists(staged)) {
					await mkdir(dirname(target), { recursive: true })
					await rename(staged, target)
				}
			}
			await rm(transactionRoot, { force: true, recursive: true })
		} catch (error) {
			await rollback(root, transactionRoot, journal)
			throw error
		}
		const updated = await loadWorkspace(root, controlDirectory, codec)
		const result: WriteSourceUnitsResult = {
			previousRevision: current.manifest.revision,
			removedPaths: removals.map(({ path }) => normalizeUnitPath(path)),
			revision: updated.manifest.revision,
			units: input.writes.map(({ path }) =>
				snapshot(updated, normalizeUnitPath(path)),
			),
		}
		idempotent.set(input.idempotencyKey, { fingerprint, result })
		publish(updated, input.idempotencyKey)
		return result
	}
	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const scheduleRefresh = (): void => {
		if (refreshTimer !== undefined) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined
			void withLock(async () =>
				publish(await loadWorkspace(root, controlDirectory, codec)),
			).catch(() => undefined)
		}, 50)
	}
	const watchers = (await collectDirectories(root, controlDirectory)).map(
		(directory) => watch(directory, scheduleRefresh),
	)
	for (const watcher of watchers) watcher.unref()

	return {
		readManifest: () =>
			withLock(
				async () =>
					(await loadWorkspace(root, controlDirectory, codec)).manifest,
			),
		readSnapshot: () =>
			withLock(async () =>
				projectSnapshot(await loadWorkspace(root, controlDirectory, codec)),
			),
		readUnit: (path) =>
			withLock(async () =>
				snapshot(
					await loadWorkspace(root, controlDirectory, codec),
					normalizeUnitPath(path),
				),
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
				const unit = result.units[0]
				if (unit === undefined)
					throw new Error(`Source write returned no unit.`)
				return unit
			}),
		writeUnits: (input) => withLock(() => writeUnitsUnlocked(input)),
		subscribe(listener) {
			listeners.add(listener)
			for (const watcher of watchers) watcher.ref()
			return () => {
				listeners.delete(listener)
				if (listeners.size === 0) {
					for (const watcher of watchers) watcher.unref()
				}
			}
		},
	}
}
