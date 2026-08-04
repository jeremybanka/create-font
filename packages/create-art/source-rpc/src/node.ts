import { createHash, randomUUID } from "node:crypto"
import { constants, watch } from "node:fs"
import {
	lstat,
	mkdir,
	open,
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
	SourceAssetConflictError,
	SourceAssetIntegrityError,
	SourceAssetNotFoundError,
	SourceAssetStageNotFoundError,
	SourceAssetTooLargeError,
	type SourceAssetDescriptor,
	type SourceAssetDigest,
	type SourceAssetService,
	type StageSourceAssetInput,
	type StagedSourceAsset,
	type WriteSourceAssetsInput,
	type WriteSourceAssetsResult,
} from "./assets.ts"

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

export {
	createSourceVersionControl,
	nodeSourceVersionControlRuntime,
	type SourceUnitChange,
	type SourceVersionControlAdapter,
	type SourceVersionControlCommandOptions,
	type SourceVersionControlCommandResult,
	type SourceVersionControlRuntime,
} from "./version-control.ts"

type CodecResult<Value> =
	| Readonly<{ ok: true; value: Value }>
	| Readonly<{
			ok: false
			errors: readonly [SourceValidationIssue, ...SourceValidationIssue[]]
	  }>

export interface JsonSourceWorkspaceCodec<Kind = string> {
	/**
	 * Optional binary-asset boundary. Asset paths are excluded from JSON
	 * parsing; descriptors remain ordinary validated JSON source units.
	 */
	assets?: Readonly<{
		descriptors(
			files: Readonly<Record<string, JsonValue>>,
		): CodecResult<readonly SourceAssetDescriptor[]>
		isPath(path: string): boolean
	}>
	assemble(files: Readonly<Record<string, JsonValue>>): CodecResult<unknown>
	format(kind: Kind, value: JsonValue, path: string): CodecResult<string>
	kindForPath(path: string): Kind | null
	parse(kind: Kind, text: string, path: string): CodecResult<JsonValue>
}

export type FileSystemSourceServiceOptions = Readonly<{
	assetStagingTtlMs?: number
	controlDirectory?: string
	maximumAssetBytes?: number
	maximumProjectAssetBytes?: number
}>

type LoadedWorkspace = Readonly<{
	assets: ReadonlyMap<string, SourceAssetDescriptor>
	manifest: SourceManifest
	revisions: ReadonlyMap<string, string>
	values: Readonly<Record<string, JsonValue>>
}>

type TransactionEntry = Readonly<{
	existed: boolean
	kind?: `asset` | `unit`
	path: string
}>
type TransactionJournal = Readonly<{ entries: readonly TransactionEntry[] }>

type StagingMetadata = StagedSourceAsset & Readonly<{ fingerprint: string }>

const DEFAULT_MAXIMUM_ASSET_BYTES = 64 * 1024 * 1024
const DEFAULT_MAXIMUM_PROJECT_ASSET_BYTES = 512 * 1024 * 1024
const DEFAULT_ASSET_STAGING_TTL_MS = 60 * 60 * 1000
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u
const MEDIA_TYPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u

function revisionForText(text: string): string {
	return `sha256:${createHash(`sha256`).update(text).digest(`hex`)}`
}

function digestForHash(hash: ReturnType<typeof createHash>): SourceAssetDigest {
	return `sha256:${hash.digest(`hex`)}`
}

function manifestRevision(
	units: readonly { readonly path: string; readonly revision: string }[],
	assets: readonly SourceAssetDescriptor[] = [],
): string {
	if (assets.length === 0) {
		return revisionForText(
			units.map((unit) => `${unit.path}\0${unit.revision}\n`).join(``),
		)
	}
	return revisionForText(
		[
			...units.map((unit) => `unit\0${unit.path}\0${unit.revision}\n`),
			...assets.map(
				(asset) =>
					`asset\0${asset.id}\0${asset.path}\0${asset.mediaType}\0${asset.byteLength}\0${asset.digest}\n`,
			),
		].join(``),
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

async function resolveInsideWithoutSymlinks(
	root: string,
	path: string,
): Promise<string> {
	const absolute = resolveInside(root, path)
	let current = root
	for (const segment of normalizeUnitPath(path).split(`/`)) {
		current = join(current, segment)
		const info = await lstat(current).catch(() => undefined)
		if (info === undefined) break
		if (info.isSymbolicLink()) {
			throw new Error(
				`Source workspaces cannot contain symbolic links: ${path}`,
			)
		}
	}
	return absolute
}

function normalizeAssetPath<Kind>(
	path: string,
	codec: JsonSourceWorkspaceCodec<Kind>,
): string {
	let normalized: string
	try {
		normalized = normalizeUnitPath(path)
	} catch {
		throw new SourceAssetNotFoundError(path)
	}
	if (codec.assets?.isPath(normalized) !== true) {
		throw new SourceAssetNotFoundError(path)
	}
	return normalized
}

function validateAssetDescriptor<Kind>(
	descriptor: SourceAssetDescriptor,
	codec: JsonSourceWorkspaceCodec<Kind>,
): SourceAssetDescriptor {
	if (
		descriptor.id.length === 0 ||
		descriptor.id.includes(`\0`) ||
		descriptor.mediaType.length === 0 ||
		!MEDIA_TYPE.test(descriptor.mediaType) ||
		!Number.isSafeInteger(descriptor.byteLength) ||
		descriptor.byteLength < 0 ||
		!SHA256_DIGEST.test(descriptor.digest)
	) {
		throw new SourceAssetIntegrityError(`Invalid source asset descriptor.`)
	}
	return {
		id: descriptor.id,
		path: normalizeAssetPath(descriptor.path, codec),
		mediaType: descriptor.mediaType,
		byteLength: descriptor.byteLength,
		digest: descriptor.digest,
	}
}

async function fileDescriptor(
	path: string,
	declared: SourceAssetDescriptor,
): Promise<SourceAssetDescriptor> {
	const info = await lstat(path).catch(() => undefined)
	if (info === undefined || !info.isFile() || info.isSymbolicLink()) {
		throw new SourceAssetNotFoundError(declared.path)
	}
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
	const hash = createHash(`sha256`)
	let byteLength = 0
	try {
		const openedInfo = await handle.stat()
		if (!openedInfo.isFile()) {
			throw new SourceAssetNotFoundError(declared.path)
		}
		for await (const chunk of handle.readableWebStream() as ReadableStream<Uint8Array>) {
			byteLength += chunk.byteLength
			hash.update(chunk)
		}
	} finally {
		await handle.close()
	}
	return {
		...declared,
		byteLength,
		digest: digestForHash(hash),
	}
}

async function* byteChunks(
	bytes: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
	if (Symbol.asyncIterator in Object(bytes)) {
		for await (const chunk of bytes as AsyncIterable<Uint8Array>) yield chunk
		return
	}
	const reader = (bytes as ReadableStream<Uint8Array>).getReader()
	try {
		while (true) {
			const result = await reader.read()
			if (result.done) return
			yield result.value
		}
	} finally {
		reader.releaseLock()
	}
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
		if (codec.assets?.isPath(path) === true) continue
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
	const units = [...revisions]
		.map(([path, revision]) => ({
			path,
			revision,
		}))
		.toSorted((left, right) => left.path.localeCompare(right.path))
	const assets = new Map<string, SourceAssetDescriptor>()
	if (codec.assets !== undefined) {
		const declared = codec.assets.descriptors(values)
		if (!declared.ok) throw validationError(declared.errors)
		const ids = new Set<string>()
		for (const rawDescriptor of declared.value) {
			const descriptor = validateAssetDescriptor(rawDescriptor, codec)
			if (ids.has(descriptor.id) || assets.has(descriptor.path)) {
				throw new SourceAssetIntegrityError(
					`Source asset IDs and paths must be unique.`,
				)
			}
			ids.add(descriptor.id)
			const absolute = resolveInside(root, descriptor.path)
			assets.set(descriptor.path, await fileDescriptor(absolute, descriptor))
		}
		for (const path of paths) {
			if (codec.assets.isPath(path) && !assets.has(path)) {
				throw new SourceAssetIntegrityError(
					`Canonical source asset ${path} is not indexed.`,
				)
			}
		}
	}
	const assetList = [...assets.values()].toSorted((left, right) =>
		left.path.localeCompare(right.path),
	)
	return {
		assets,
		manifest: {
			...(assetList.length === 0 ? {} : { assets: assetList }),
			revision: manifestRevision(units, assetList),
			units,
		},
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
		const target = await resolveInsideWithoutSymlinks(root, entry.path)
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
): Promise<SourceService & SourceAssetService> {
	const root = await realpath(resolve(rootInput))
	const controlDirectory = options.controlDirectory ?? `.create-art`
	if (
		controlDirectory.includes(`/`) ||
		normalizeUnitPath(controlDirectory) !== controlDirectory
	) {
		throw new Error(`The source control directory must be one safe segment.`)
	}
	const controlInfo = await lstat(join(root, controlDirectory)).catch(
		() => undefined,
	)
	if (
		controlInfo !== undefined &&
		(!controlInfo.isDirectory() || controlInfo.isSymbolicLink())
	) {
		throw new Error(`The source control directory cannot be a symbolic link.`)
	}
	const maximumAssetBytes =
		options.maximumAssetBytes ?? DEFAULT_MAXIMUM_ASSET_BYTES
	const maximumProjectAssetBytes =
		options.maximumProjectAssetBytes ?? DEFAULT_MAXIMUM_PROJECT_ASSET_BYTES
	const assetStagingTtlMs =
		options.assetStagingTtlMs ?? DEFAULT_ASSET_STAGING_TTL_MS
	for (const [name, value] of [
		[`maximumAssetBytes`, maximumAssetBytes],
		[`maximumProjectAssetBytes`, maximumProjectAssetBytes],
		[`assetStagingTtlMs`, assetStagingTtlMs],
	] as const) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}
	await recover(root, controlDirectory)
	const load = async (): Promise<LoadedWorkspace> => {
		const workspace = await loadWorkspace(root, controlDirectory, codec)
		let projectBytes = 0
		for (const asset of workspace.assets.values()) {
			if (asset.byteLength > maximumAssetBytes) {
				throw new SourceAssetTooLargeError(maximumAssetBytes)
			}
			projectBytes += asset.byteLength
			if (projectBytes > maximumProjectAssetBytes) {
				throw new SourceAssetTooLargeError(maximumProjectAssetBytes)
			}
		}
		return workspace
	}
	let published = await load()
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
	const idempotentUnits = new Map<
		string,
		Readonly<{ fingerprint: string; result: WriteSourceUnitsResult }>
	>()
	const idempotentAssets = new Map<
		string,
		Readonly<{ fingerprint: string; result: WriteSourceAssetsResult }>
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
		...(workspace.assets.size === 0
			? {}
			: { assets: [...workspace.assets.values()] }),
		revision: workspace.manifest.revision,
		units: workspace.manifest.units.map(({ path }) =>
			snapshot(workspace, path),
		),
	})
	const publish = (next: LoadedWorkspace, operationId?: string): void => {
		if (next.manifest.revision === published.manifest.revision) return
		const previous = published
		const nextPaths = new Set(next.manifest.units.map(({ path }) => path))
		const changedAssets = [...next.assets.values()].filter(
			(asset) =>
				previous.assets.get(asset.path)?.digest !== asset.digest ||
				previous.assets.get(asset.path)?.id !== asset.id ||
				previous.assets.get(asset.path)?.mediaType !== asset.mediaType,
		)
		const removedAssetPaths = [...previous.assets.keys()].filter(
			(path) => !next.assets.has(path),
		)
		const event: SourceChangedEvent = {
			type: `source.changed`,
			...(operationId === undefined ? {} : { operationId }),
			...(changedAssets.length === 0 ? {} : { assets: changedAssets }),
			previousRevision: previous.manifest.revision,
			...(removedAssetPaths.length === 0 ? {} : { removedAssetPaths }),
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
	const validateAssetInventory = (
		values: Readonly<Record<string, JsonValue>>,
		assets: ReadonlyMap<string, SourceAssetDescriptor>,
	): void => {
		if (codec.assets === undefined) {
			if (assets.size > 0) {
				throw new SourceAssetIntegrityError(
					`This source workspace does not support binary assets.`,
				)
			}
			return
		}
		const result = codec.assets.descriptors(values)
		if (!result.ok) throw validationError(result.errors)
		const declared = new Map<string, SourceAssetDescriptor>()
		const ids = new Set<string>()
		for (const rawDescriptor of result.value) {
			const descriptor = validateAssetDescriptor(rawDescriptor, codec)
			if (declared.has(descriptor.path) || ids.has(descriptor.id)) {
				throw new SourceAssetIntegrityError(
					`Source asset IDs and paths must be unique.`,
				)
			}
			declared.set(descriptor.path, descriptor)
			ids.add(descriptor.id)
		}
		if (declared.size !== assets.size) {
			throw new SourceAssetIntegrityError(
				`The asset inventory and canonical asset set do not match.`,
			)
		}
		for (const [path, expected] of declared) {
			const actual = assets.get(path)
			if (
				actual === undefined ||
				actual.id !== expected.id ||
				actual.mediaType !== expected.mediaType ||
				actual.byteLength !== expected.byteLength ||
				actual.digest !== expected.digest
			) {
				throw new SourceAssetIntegrityError(
					`Asset inventory metadata does not match ${path}.`,
				)
			}
		}
	}
	const writeUnitsUnlocked = async (
		input: WriteSourceUnitsInput,
	): Promise<WriteSourceUnitsResult> => {
		const removals = input.removals ?? []
		if (input.writes.length + removals.length === 0) {
			throw new Error(`A source transaction cannot be empty.`)
		}
		const fingerprint = JSON.stringify({ removals, writes: input.writes })
		const previousResult = idempotentUnits.get(input.idempotencyKey)
		if (previousResult !== undefined) {
			if (previousResult.fingerprint !== fingerprint) {
				throw new Error(
					`Idempotency key ${input.idempotencyKey} was reused for a different transaction.`,
				)
			}
			return previousResult.result
		}
		const current = await load()
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
		validateAssetInventory(candidate, current.assets)

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
				const target = await resolveInsideWithoutSymlinks(root, entry.path)
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
		const updated = await load()
		const result: WriteSourceUnitsResult = {
			previousRevision: current.manifest.revision,
			removedPaths: removals.map(({ path }) => normalizeUnitPath(path)),
			revision: updated.manifest.revision,
			units: input.writes.map(({ path }) =>
				snapshot(updated, normalizeUnitPath(path)),
			),
		}
		idempotentUnits.set(input.idempotencyKey, { fingerprint, result })
		publish(updated, input.idempotencyKey)
		return result
	}
	const assetStagingRoot = join(root, controlDirectory, `asset-staging`)
	const stagingTokenFor = (operationId: string, path: string): string =>
		createHash(`sha256`)
			.update(operationId)
			.update(`\0`)
			.update(path)
			.digest(`hex`)
	const stagingRootFor = (stagingToken: string): string => {
		if (!/^[0-9a-f]{64}$/u.test(stagingToken)) {
			throw new SourceAssetStageNotFoundError(stagingToken)
		}
		return join(assetStagingRoot, stagingToken)
	}
	const assertSafeAssetStagingRoot = async (): Promise<void> => {
		const info = await lstat(assetStagingRoot).catch(() => undefined)
		if (info !== undefined && (!info.isDirectory() || info.isSymbolicLink())) {
			throw new SourceAssetIntegrityError(
				`Symbolic links are not allowed in asset staging.`,
			)
		}
	}
	const readStagingMetadata = async (
		stagingToken: string,
	): Promise<StagingMetadata> => {
		await assertSafeAssetStagingRoot()
		const stagingRoot = stagingRootFor(stagingToken)
		const stagingInfo = await lstat(stagingRoot).catch(() => undefined)
		const metadataInfo = await lstat(join(stagingRoot, `stage.json`)).catch(
			() => undefined,
		)
		if (
			stagingInfo === undefined ||
			!stagingInfo.isDirectory() ||
			stagingInfo.isSymbolicLink() ||
			metadataInfo === undefined ||
			!metadataInfo.isFile() ||
			metadataInfo.isSymbolicLink() ||
			metadataInfo.size > 64 * 1024
		) {
			throw new SourceAssetStageNotFoundError(stagingToken)
		}
		const metadata = await readFile(join(stagingRoot, `stage.json`), `utf8`)
			.then((text) => JSON.parse(text) as StagingMetadata)
			.catch(() => undefined)
		if (
			metadata === undefined ||
			metadata.stagingToken !== stagingToken ||
			typeof metadata.expiresAt !== `string` ||
			!Number.isFinite(Date.parse(metadata.expiresAt)) ||
			Date.parse(metadata.expiresAt) <= Date.now()
		) {
			await rm(stagingRoot, { force: true, recursive: true })
			throw new SourceAssetStageNotFoundError(stagingToken)
		}
		return metadata
	}
	const collectExpiredAssetStagesUnlocked = async (): Promise<number> => {
		await assertSafeAssetStagingRoot()
		let removed = 0
		for (const entry of await readdir(assetStagingRoot, {
			withFileTypes: true,
		}).catch(() => [])) {
			const stagingRoot = join(assetStagingRoot, entry.name)
			if (!entry.isDirectory() || entry.isSymbolicLink()) {
				await rm(stagingRoot, { force: true, recursive: true })
				removed += 1
				continue
			}
			const metadataPath = join(stagingRoot, `stage.json`)
			const metadataInfo = await lstat(metadataPath).catch(() => undefined)
			const metadata =
				metadataInfo?.isFile() === true &&
				!metadataInfo.isSymbolicLink() &&
				metadataInfo.size <= 64 * 1024
					? await readFile(metadataPath, `utf8`)
							.then((text) => JSON.parse(text) as Partial<StagingMetadata>)
							.catch(() => undefined)
					: undefined
			if (
				metadata === undefined ||
				typeof metadata.expiresAt !== `string` ||
				!Number.isFinite(Date.parse(metadata.expiresAt)) ||
				Date.parse(metadata.expiresAt) <= Date.now()
			) {
				await rm(stagingRoot, { force: true, recursive: true })
				removed += 1
			}
		}
		return removed
	}
	const activeStagingMetadataUnlocked = async (
		excludedToken: string,
	): Promise<readonly StagingMetadata[]> => {
		const stages: StagingMetadata[] = []
		for (const entry of await readdir(assetStagingRoot, {
			withFileTypes: true,
		}).catch(() => [])) {
			if (
				entry.name === excludedToken ||
				!entry.isDirectory() ||
				entry.isSymbolicLink()
			) {
				continue
			}
			const metadataPath = join(assetStagingRoot, entry.name, `stage.json`)
			const metadataInfo = await lstat(metadataPath).catch(() => undefined)
			const metadata =
				metadataInfo?.isFile() === true &&
				!metadataInfo.isSymbolicLink() &&
				metadataInfo.size <= 64 * 1024
					? await readFile(metadataPath, `utf8`)
							.then((text) => JSON.parse(text) as StagingMetadata)
							.catch(() => undefined)
					: undefined
			if (
				metadata !== undefined &&
				Date.parse(metadata.expiresAt) > Date.now()
			) {
				stages.push(metadata)
			}
		}
		return stages
	}
	await collectExpiredAssetStagesUnlocked()
	const stageAssetUnlocked = async (
		input: StageSourceAssetInput,
	): Promise<StagedSourceAsset> => {
		if (codec.assets === undefined) {
			throw new SourceAssetNotFoundError(input.descriptor.path)
		}
		await assertSafeAssetStagingRoot()
		if (
			input.operationId.length === 0 ||
			input.operationId.length > 256 ||
			input.operationId.includes(`\0`)
		) {
			throw new SourceAssetIntegrityError(`Invalid asset operation identity.`)
		}
		const descriptor = validateAssetDescriptor(input.descriptor, codec)
		const stagingToken = stagingTokenFor(input.operationId, descriptor.path)
		const stagingRoot = stagingRootFor(stagingToken)
		const stagingInfo = await lstat(stagingRoot).catch(() => undefined)
		if (stagingInfo?.isSymbolicLink() === true) {
			throw new SourceAssetIntegrityError(
				`Symbolic links are not allowed in asset staging.`,
			)
		}
		if (descriptor.byteLength > maximumAssetBytes) {
			throw new SourceAssetTooLargeError(
				maximumAssetBytes,
				`Source asset declares ${descriptor.byteLength} bytes, exceeding the ${maximumAssetBytes} byte asset limit.`,
			)
		}
		const current = await load()
		const projectedSizes = new Map(
			[...current.assets].map(([path, asset]) => [path, asset.byteLength]),
		)
		for (const stage of await activeStagingMetadataUnlocked(stagingToken)) {
			projectedSizes.set(
				stage.descriptor.path,
				Math.max(
					projectedSizes.get(stage.descriptor.path) ?? 0,
					stage.descriptor.byteLength,
				),
			)
		}
		projectedSizes.set(
			descriptor.path,
			Math.max(projectedSizes.get(descriptor.path) ?? 0, descriptor.byteLength),
		)
		const projectedBytes = [...projectedSizes.values()].reduce(
			(total, length) => total + length,
			0,
		)
		if (projectedBytes > maximumProjectAssetBytes) {
			throw new SourceAssetTooLargeError(
				maximumProjectAssetBytes,
				`Staging this asset would exceed the ${maximumProjectAssetBytes} byte project asset limit.`,
			)
		}
		const fingerprint = JSON.stringify(descriptor)
		const existingMetadataPath = join(stagingRoot, `stage.json`)
		const existingMetadataInfo = await lstat(existingMetadataPath).catch(
			() => undefined,
		)
		const existing =
			existingMetadataInfo?.isFile() === true &&
			!existingMetadataInfo.isSymbolicLink() &&
			existingMetadataInfo.size <= 64 * 1024
				? await readFile(existingMetadataPath, `utf8`)
						.then((text) => JSON.parse(text) as StagingMetadata)
						.catch(() => undefined)
				: undefined
		if (existing !== undefined && Date.parse(existing.expiresAt) > Date.now()) {
			if (existing.fingerprint !== fingerprint) {
				throw new SourceAssetIntegrityError(
					`Asset operation identity was reused with different metadata.`,
				)
			}
			return existing
		}
		await rm(stagingRoot, { force: true, recursive: true })
		await mkdir(stagingRoot, { recursive: true })
		const stagedPath = join(stagingRoot, `asset`)
		const handle = await open(stagedPath, `wx`, 0o600)
		const hash = createHash(`sha256`)
		let byteLength = 0
		try {
			for await (const chunk of byteChunks(input.bytes)) {
				if (!(chunk instanceof Uint8Array)) {
					throw new SourceAssetIntegrityError(
						`Asset upload yielded a non-byte chunk.`,
					)
				}
				if (
					byteLength + chunk.byteLength > descriptor.byteLength ||
					byteLength + chunk.byteLength > maximumAssetBytes
				) {
					throw new SourceAssetTooLargeError(
						Math.min(descriptor.byteLength, maximumAssetBytes),
					)
				}
				hash.update(chunk)
				let offset = 0
				while (offset < chunk.byteLength) {
					const { bytesWritten } = await handle.write(
						chunk,
						offset,
						chunk.byteLength - offset,
					)
					offset += bytesWritten
				}
				byteLength += chunk.byteLength
			}
			await handle.sync()
		} catch (error) {
			await handle.close()
			await rm(stagingRoot, { force: true, recursive: true })
			throw error
		}
		await handle.close()
		const digest = digestForHash(hash)
		if (byteLength !== descriptor.byteLength) {
			await rm(stagingRoot, { force: true, recursive: true })
			throw new SourceAssetIntegrityError(
				`Asset upload length ${byteLength} does not match declared length ${descriptor.byteLength}.`,
			)
		}
		if (digest !== descriptor.digest) {
			await rm(stagingRoot, { force: true, recursive: true })
			throw new SourceAssetIntegrityError(
				`Asset upload digest ${digest} does not match declared digest ${descriptor.digest}.`,
			)
		}
		const staged: StagingMetadata = {
			descriptor,
			expiresAt: new Date(Date.now() + assetStagingTtlMs).toISOString(),
			fingerprint,
			operationId: input.operationId,
			stagingToken,
		}
		await writeFile(
			join(stagingRoot, `stage.json`),
			`${JSON.stringify(staged, null, "\t")}\n`,
		)
		return staged
	}
	const writeAssetsUnlocked = async (
		input: WriteSourceAssetsInput,
	): Promise<WriteSourceAssetsResult> => {
		if (codec.assets === undefined) {
			throw new SourceAssetIntegrityError(
				`This source workspace does not support binary assets.`,
			)
		}
		const writes = input.writes ?? []
		const removals = input.removals ?? []
		const assetRemovals = input.assetRemovals ?? []
		if (
			writes.length +
				removals.length +
				input.assetWrites.length +
				assetRemovals.length ===
			0
		) {
			throw new Error(`A source asset transaction cannot be empty.`)
		}
		const fingerprint = JSON.stringify({
			assetRemovals,
			assetWrites: input.assetWrites,
			removals,
			writes,
		})
		const previousResult = idempotentAssets.get(input.idempotencyKey)
		if (previousResult !== undefined) {
			if (previousResult.fingerprint !== fingerprint) {
				throw new Error(
					`Idempotency key ${input.idempotencyKey} was reused for a different transaction.`,
				)
			}
			return previousResult.result
		}

		const current = await load()
		const candidate: Record<string, JsonValue> = { ...current.values }
		const unitPaths = new Set<string>()
		const formatted = new Map<string, string>()
		for (const write of writes) {
			const path = normalizeUnitPath(write.path)
			if (unitPaths.has(path)) throw new Error(`Duplicate source unit ${path}.`)
			unitPaths.add(path)
			const actual = current.revisions.get(path) ?? null
			if (actual !== write.expectedRevision) {
				throw new SourceUnitConflictError(path, write.expectedRevision, actual)
			}
			const kind = codec.kindForPath(path)
			if (kind === null) throw new SourceUnitNotFoundError(path)
			const formattedUnit = codec.format(kind, write.value, path)
			if (!formattedUnit.ok) throw validationError(formattedUnit.errors)
			candidate[path] = write.value
			formatted.set(path, formattedUnit.value)
		}
		for (const removal of removals) {
			const path = normalizeUnitPath(removal.path)
			if (unitPaths.has(path)) throw new Error(`Duplicate source unit ${path}.`)
			unitPaths.add(path)
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

		const candidateAssets = new Map(current.assets)
		const assetPaths = new Set<string>()
		const stagedAssets: StagingMetadata[] = []
		for (const write of input.assetWrites) {
			const staged = await readStagingMetadata(write.stagingToken)
			if (staged.operationId !== input.idempotencyKey) {
				throw new SourceAssetIntegrityError(
					`Asset staging operation does not match the transaction identity.`,
				)
			}
			const descriptor = validateAssetDescriptor(staged.descriptor, codec)
			if (assetPaths.has(descriptor.path)) {
				throw new Error(`Duplicate source asset ${descriptor.path}.`)
			}
			assetPaths.add(descriptor.path)
			const actual = current.assets.get(descriptor.path)?.digest ?? null
			if (actual !== write.expectedDigest) {
				throw new SourceAssetConflictError(
					descriptor.path,
					write.expectedDigest,
					actual,
				)
			}
			const verified = await fileDescriptor(
				join(stagingRootFor(write.stagingToken), `asset`),
				descriptor,
			)
			if (
				verified.byteLength !== descriptor.byteLength ||
				verified.digest !== descriptor.digest
			) {
				throw new SourceAssetIntegrityError(
					`Staged asset ${descriptor.path} failed commit verification.`,
				)
			}
			candidateAssets.set(descriptor.path, descriptor)
			stagedAssets.push(staged)
		}
		for (const removal of assetRemovals) {
			const path = normalizeAssetPath(removal.path, codec)
			if (assetPaths.has(path))
				throw new Error(`Duplicate source asset ${path}.`)
			assetPaths.add(path)
			const actual = current.assets.get(path)?.digest ?? null
			if (actual !== removal.expectedDigest) {
				throw new SourceAssetConflictError(path, removal.expectedDigest, actual)
			}
			candidateAssets.delete(path)
		}
		const projectAssetBytes = [...candidateAssets.values()].reduce(
			(total, asset) => total + asset.byteLength,
			0,
		)
		if (projectAssetBytes > maximumProjectAssetBytes) {
			throw new SourceAssetTooLargeError(maximumProjectAssetBytes)
		}
		const assembled = codec.assemble(candidate)
		if (!assembled.ok) throw validationError(assembled.errors)
		validateAssetInventory(candidate, candidateAssets)

		const transactionRoot = join(
			root,
			controlDirectory,
			`transactions`,
			randomUUID(),
		)
		const entries: TransactionEntry[] = []
		for (const write of writes) {
			const path = normalizeUnitPath(write.path)
			const staged = join(transactionRoot, `staged`, path)
			await mkdir(dirname(staged), { recursive: true })
			await writeFile(staged, formatted.get(path) ?? ``)
			entries.push({
				existed: current.revisions.has(path),
				kind: `unit`,
				path,
			})
		}
		for (const removal of removals) {
			entries.push({
				existed: true,
				kind: `unit`,
				path: normalizeUnitPath(removal.path),
			})
		}
		for (const stagedAsset of stagedAssets) {
			const path = stagedAsset.descriptor.path
			entries.push({
				existed: current.assets.has(path),
				kind: `asset`,
				path,
			})
		}
		for (const removal of assetRemovals) {
			entries.push({
				existed: true,
				kind: `asset`,
				path: normalizeAssetPath(removal.path, codec),
			})
		}
		const journal: TransactionJournal = { entries }
		await mkdir(transactionRoot, { recursive: true })
		await writeFile(
			join(transactionRoot, `transaction.json`),
			`${JSON.stringify(journal, null, "\t")}\n`,
		)
		try {
			for (const stagedAsset of stagedAssets) {
				const staged = join(
					transactionRoot,
					`staged`,
					stagedAsset.descriptor.path,
				)
				await mkdir(dirname(staged), { recursive: true })
				await rename(
					join(stagingRootFor(stagedAsset.stagingToken), `asset`),
					staged,
				)
			}
			for (const entry of entries) {
				const target = await resolveInsideWithoutSymlinks(root, entry.path)
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
		for (const stagedAsset of stagedAssets) {
			await rm(stagingRootFor(stagedAsset.stagingToken), {
				force: true,
				recursive: true,
			})
		}
		const updated = await load()
		const result: WriteSourceAssetsResult = {
			assets: stagedAssets.map(({ descriptor }) => descriptor),
			previousRevision: current.manifest.revision,
			removedAssetPaths: assetRemovals.map(({ path }) =>
				normalizeAssetPath(path, codec),
			),
			removedPaths: removals.map(({ path }) => normalizeUnitPath(path)),
			revision: updated.manifest.revision,
			units: writes.map(({ path }) =>
				snapshot(updated, normalizeUnitPath(path)),
			),
		}
		idempotentAssets.set(input.idempotencyKey, { fingerprint, result })
		publish(updated, input.idempotencyKey)
		return result
	}
	let refreshTimer: ReturnType<typeof setTimeout> | undefined
	const scheduleRefresh = (): void => {
		if (refreshTimer !== undefined) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined
			void withLock(async () => publish(await load())).catch(() => undefined)
		}, 50)
	}
	const watchers = (await collectDirectories(root, controlDirectory)).map(
		(directory) => watch(directory, scheduleRefresh),
	)
	for (const watcher of watchers) watcher.unref()
	if (codec.assets !== undefined) {
		const stagingGcTimer = setInterval(
			() => {
				void withLock(collectExpiredAssetStagesUnlocked).catch(() => undefined)
			},
			Math.min(Math.max(assetStagingTtlMs, 1_000), 60_000),
		)
		stagingGcTimer.unref()
	}

	return {
		collectExpiredAssetStages: () =>
			withLock(collectExpiredAssetStagesUnlocked),
		discardAssetStage: (stagingToken) =>
			withLock(async () => {
				const metadata = await readStagingMetadata(stagingToken).catch(
					(error: unknown) => {
						if (error instanceof SourceAssetStageNotFoundError) return undefined
						throw error
					},
				)
				if (metadata === undefined) return
				await rm(stagingRootFor(stagingToken), {
					force: true,
					recursive: true,
				})
			}),
		readAsset: (path) =>
			withLock(async () => {
				const normalized = normalizeAssetPath(path, codec)
				const workspace = await load()
				const descriptor = workspace.assets.get(normalized)
				if (descriptor === undefined) {
					throw new SourceAssetNotFoundError(path)
				}
				const absolute = resolveInside(root, normalized)
				const info = await lstat(absolute).catch(() => undefined)
				if (info === undefined || !info.isFile() || info.isSymbolicLink()) {
					throw new SourceAssetNotFoundError(path)
				}
				const handle = await open(
					absolute,
					constants.O_RDONLY | constants.O_NOFOLLOW,
				)
				const openedInfo = await handle.stat()
				if (!openedInfo.isFile()) {
					await handle.close()
					throw new SourceAssetNotFoundError(path)
				}
				return {
					bytes: handle.readableWebStream({
						autoClose: true,
					}) as ReadableStream<Uint8Array>,
					descriptor,
				}
			}),
		readManifest: () => withLock(async () => (await load()).manifest),
		readSnapshot: () => withLock(async () => projectSnapshot(await load())),
		readUnit: (path) =>
			withLock(async () => snapshot(await load(), normalizeUnitPath(path))),
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
		stageAsset: (input) => withLock(() => stageAssetUnlocked(input)),
		writeAssets: (input) =>
			withLock(async () => {
				try {
					return await writeAssetsUnlocked(input)
				} catch (error) {
					for (const stagingToken of new Set(
						input.assetWrites.map(({ stagingToken }) => stagingToken),
					)) {
						try {
							await rm(stagingRootFor(stagingToken), {
								force: true,
								recursive: true,
							})
						} catch {
							// Invalid or already-removed tokens own no stage to clean.
						}
					}
					throw error
				}
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
