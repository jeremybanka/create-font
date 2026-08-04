import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

import {
	SourceVersionControlError,
	type CommitSourceUnitsInput,
	type CommitSourceUnitsResult,
	type JsonValue,
	type ReadSourceComparisonInput,
	type SourceChangeGroup,
	type SourceChangeKind,
	type SourceComparison,
	type SourceProjectSnapshot,
	type SourceUnitSnapshot,
	type SourceVersionControlService,
} from "./contracts.ts"
import type { SourceAssetDescriptor } from "./assets.ts"

const MAX_SNAPSHOT_UNITS = 2_000
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
const GIT_TIMEOUT_MS = 15_000

export type SourceUnitChange = Readonly<{
	after?: SourceUnitSnapshot
	assetAfter?: SourceAssetDescriptor
	assetBefore?: SourceAssetDescriptor
	before?: SourceUnitSnapshot
	change: SourceChangeKind
	path: string
}>

export interface SourceVersionControlAdapter {
	assets?: Readonly<{
		descriptors(
			values: Readonly<Record<string, JsonValue>>,
		):
			| readonly SourceAssetDescriptor[]
			| Promise<readonly SourceAssetDescriptor[]>
		isPath(path: string): boolean
	}>
	groupChanges(
		changes: readonly SourceUnitChange[],
	): readonly SourceChangeGroup[]
	/** Override UTF-8 decoding for raw textual units that must retain a BOM scalar. */
	decodeUnit?(path: string, bytes: Uint8Array): string
	includesPath(path: string): boolean
	parseUnit(path: string, text: string): JsonValue | Promise<JsonValue>
	validateComparison?(
		base: SourceProjectSnapshot,
		target: SourceProjectSnapshot,
		changes: readonly SourceUnitChange[],
	): void | Promise<void>
	validateSnapshot(
		values: Readonly<Record<string, JsonValue>>,
	): void | Promise<void>
}

export type SourceVersionControlCommandOptions = Readonly<{
	cwd?: string
	env?: NodeJS.ProcessEnv
	input?: string
	timeout?: number
}>

export type SourceVersionControlCommandResult = Readonly<{
	exitCode: number | null
	stderr: string
	stdout: Uint8Array
}>

export interface SourceVersionControlRuntime {
	run(
		command: string,
		args: readonly string[],
		options?: SourceVersionControlCommandOptions,
	): Promise<SourceVersionControlCommandResult>
}

type GitContext = Readonly<{
	projectPrefix: string
	repositoryRoot: string
}>

type GitResult = Readonly<{
	stderr: string
	stdout: Uint8Array
}>

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}

export const nodeSourceVersionControlRuntime: SourceVersionControlRuntime = {
	run(command, args, options = {}) {
		return new Promise((resolveResult, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd,
				env: options.env,
				stdio: [
					options.input === undefined ? `ignore` : `pipe`,
					`pipe`,
					`pipe`,
				],
			})
			const stdout: Uint8Array[] = []
			const stderr: Uint8Array[] = []
			child.stdout?.on(`data`, (chunk: Uint8Array) => stdout.push(chunk))
			child.stderr?.on(`data`, (chunk: Uint8Array) => stderr.push(chunk))
			child.once(`error`, reject)
			const timeout =
				options.timeout === undefined
					? undefined
					: setTimeout(() => child.kill(), options.timeout)
			child.once(`close`, (exitCode) => {
				if (timeout !== undefined) clearTimeout(timeout)
				resolveResult({
					exitCode,
					stderr: new TextDecoder().decode(concatenate(stderr)),
					stdout: concatenate(stdout),
				})
			})
			child.stdin?.end(options.input)
		})
	},
}

function textRevision(text: string): string {
	return `sha256:${createHash(`sha256`).update(text).digest(`hex`)}`
}

function byteRevision(bytes: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash(`sha256`).update(bytes).digest(`hex`)}`
}

function comparisonIdentity(base: string, target: string): string {
	return textRevision(`${base}\0${target}`)
}

function validRef(ref: string): string {
	if (
		ref.length === 0 ||
		ref.length > 256 ||
		ref.includes(`\0`) ||
		ref.includes(`\n`) ||
		ref.includes(`\r`)
	) {
		throw new SourceVersionControlError(
			`source.invalid_ref`,
			`The comparison ref is not valid.`,
		)
	}
	return ref
}

function validUnitPath(path: string): string {
	if (
		path.length === 0 ||
		path.startsWith(`/`) ||
		path.includes(`\\`) ||
		path.includes(`\0`) ||
		path.split(`/`).some((part) => part === `` || part === `.` || part === `..`)
	) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The source change contains an unsafe project path.`,
		)
	}
	return path
}

async function runGit(
	context: GitContext | string,
	args: readonly string[],
	runtime: SourceVersionControlRuntime,
	options: Readonly<{
		env?: NodeJS.ProcessEnv
		input?: string
	}> = {},
): Promise<GitResult> {
	let result: SourceVersionControlCommandResult
	try {
		result = await runtime.run(`git`, args, {
			cwd: typeof context === `string` ? context : context.repositoryRoot,
			env: { ...process.env, ...options.env },
			...(options.input === undefined ? {} : { input: options.input }),
			timeout: GIT_TIMEOUT_MS,
		})
	} catch (error) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			error instanceof Error
				? error.message
				: `Git could not read the source repository.`,
		)
	}
	if (result.exitCode !== 0) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			result.stderr.trim() || `Git could not read the source repository.`,
		)
	}
	return { stdout: result.stdout, stderr: result.stderr }
}

async function discoverGitContext(
	projectRoot: string,
	runtime: SourceVersionControlRuntime,
): Promise<GitContext> {
	let repositoryRoot: string
	try {
		const result = await runGit(
			projectRoot,
			[`rev-parse`, `--show-toplevel`],
			runtime,
		)
		repositoryRoot = new TextDecoder().decode(result.stdout).trim()
	} catch (error) {
		throw new SourceVersionControlError(
			`source.git_unavailable`,
			error instanceof Error
				? `Version control is unavailable: ${error.message}`
				: `Version control is unavailable for this source workspace.`,
		)
	}
	const projectRelative = relative(repositoryRoot, projectRoot)
	if (
		!isAbsolute(repositoryRoot) ||
		projectRelative === `..` ||
		projectRelative.startsWith(`..${sep}`)
	) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The source workspace is not contained by its Git repository.`,
		)
	}
	return {
		projectPrefix:
			projectRelative === `` ? `` : projectRelative.split(sep).join(`/`),
		repositoryRoot,
	}
}

async function resolveCommit(
	context: GitContext,
	ref: string,
	runtime: SourceVersionControlRuntime,
): Promise<string> {
	try {
		const result = await runGit(
			context,
			[
				`rev-parse`,
				`--verify`,
				`--end-of-options`,
				`${validRef(ref)}^{commit}`,
			],
			runtime,
		)
		return new TextDecoder().decode(result.stdout).trim()
	} catch (error) {
		throw new SourceVersionControlError(
			`source.invalid_ref`,
			`Git ref ${JSON.stringify(ref)} does not resolve to a commit. ${
				error instanceof Error ? error.message : ``
			}`.trim(),
		)
	}
}

function repositoryPath(context: GitContext, path: string): string {
	return context.projectPrefix === ``
		? validUnitPath(path)
		: `${context.projectPrefix}/${validUnitPath(path)}`
}

async function snapshotAtCommit(
	context: GitContext,
	commit: string,
	adapter: SourceVersionControlAdapter,
	runtime: SourceVersionControlRuntime,
): Promise<SourceProjectSnapshot> {
	const pathspec = context.projectPrefix === `` ? `.` : context.projectPrefix
	const listed = await runGit(
		context,
		[`ls-tree`, `-r`, `-z`, `--name-only`, commit, `--`, pathspec],
		runtime,
	)
	const prefix = context.projectPrefix === `` ? `` : `${context.projectPrefix}/`
	const treePaths = new TextDecoder()
		.decode(listed.stdout)
		.split(`\0`)
		.filter(Boolean)
		.filter((path) => path.startsWith(prefix))
		.map((path) => validUnitPath(path.slice(prefix.length)))
		.toSorted()
	const paths = treePaths.filter(
		(path) =>
			adapter.includesPath(path) || adapter.assets?.isPath(path) === true,
	)
	if (paths.length === 0) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The selected ref does not contain this source workspace.`,
		)
	}
	if (paths.length > MAX_SNAPSHOT_UNITS) {
		throw new SourceVersionControlError(
			`source.snapshot_too_large`,
			`The selected source snapshot has more than ${MAX_SNAPSHOT_UNITS} units.`,
		)
	}
	const byteLengths = new Map<string, number>()
	let totalBytes = 0
	for (const path of paths) {
		const sizeText = new TextDecoder()
			.decode(
				(
					await runGit(
						context,
						[`cat-file`, `-s`, `${commit}:${repositoryPath(context, path)}`],
						runtime,
					)
				).stdout,
			)
			.trim()
		const byteLength = Number(sizeText)
		if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`Git returned an invalid byte length for source path ${JSON.stringify(path)}.`,
			)
		}
		byteLengths.set(path, byteLength)
		totalBytes += byteLength
		if (totalBytes > MAX_SNAPSHOT_BYTES) {
			throw new SourceVersionControlError(
				`source.snapshot_too_large`,
				`The selected source snapshot exceeds the ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MiB review limit.`,
			)
		}
	}
	const units: SourceUnitSnapshot[] = []
	const values: Record<string, JsonValue> = {}
	for (const path of paths.filter((path) => adapter.includesPath(path))) {
		if (adapter.assets?.isPath(path) === true) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`Source path ${JSON.stringify(path)} is ambiguously classified as JSON and binary.`,
			)
		}
		const blob = await runGit(
			context,
			[`show`, `--no-textconv`, `${commit}:${repositoryPath(context, path)}`],
			runtime,
		)
		if (blob.stdout.byteLength !== byteLengths.get(path)) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`Git returned inconsistent bytes for source path ${JSON.stringify(path)}.`,
			)
		}
		const text =
			adapter.decodeUnit?.(path, blob.stdout) ??
			new TextDecoder().decode(blob.stdout)
		const value = await adapter.parseUnit(path, text)
		values[path] = value
		units.push({ path, revision: byteRevision(blob.stdout), value })
	}
	await adapter.validateSnapshot(values)
	if (adapter.assets === undefined) return { revision: commit, units }
	const declared = await adapter.assets.descriptors(values)
	const descriptors = new Map<string, SourceAssetDescriptor>()
	const ids = new Set<string>()
	for (const descriptor of declared) {
		const path = validUnitPath(descriptor.path)
		if (
			descriptor.id.length === 0 ||
			descriptor.id.includes(`\0`) ||
			descriptor.mediaType.length === 0 ||
			!Number.isSafeInteger(descriptor.byteLength) ||
			descriptor.byteLength < 0 ||
			!/^sha256:[0-9a-f]{64}$/u.test(descriptor.digest) ||
			!adapter.assets.isPath(path) ||
			descriptors.has(path) ||
			ids.has(descriptor.id)
		) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`The selected ref declares an invalid source asset inventory.`,
			)
		}
		descriptors.set(path, { ...descriptor, path })
		ids.add(descriptor.id)
	}
	const assetPaths = paths.filter(
		(path) => adapter.assets?.isPath(path) === true,
	)
	if (
		JSON.stringify(assetPaths) !==
		JSON.stringify([...descriptors.keys()].toSorted())
	) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The selected ref's binary assets do not match its declared asset inventory.`,
		)
	}
	const assets: SourceAssetDescriptor[] = []
	for (const path of assetPaths) {
		const expected = descriptors.get(path)!
		const blob = await runGit(
			context,
			[`show`, `--no-textconv`, `${commit}:${repositoryPath(context, path)}`],
			runtime,
		)
		const byteLength = byteLengths.get(path)
		const digest = byteRevision(blob.stdout)
		if (
			blob.stdout.byteLength !== byteLength ||
			expected.byteLength !== byteLength ||
			expected.digest !== digest
		) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`Binary source asset ${JSON.stringify(path)} does not match its declared digest and length.`,
			)
		}
		assets.push(expected)
	}
	return { assets, revision: commit, units }
}

function sourceUnitChanges(
	base: SourceProjectSnapshot,
	target: SourceProjectSnapshot,
): readonly SourceUnitChange[] {
	const baseByPath = new Map(base.units.map((unit) => [unit.path, unit]))
	const targetByPath = new Map(target.units.map((unit) => [unit.path, unit]))
	const unitChanges = [
		...new Set([...baseByPath.keys(), ...targetByPath.keys()]),
	]
		.toSorted()
		.flatMap((path): readonly SourceUnitChange[] => {
			const before = baseByPath.get(path)
			const after = targetByPath.get(path)
			if (
				before !== undefined &&
				after !== undefined &&
				JSON.stringify(before.value) === JSON.stringify(after.value)
			)
				return []
			return [
				{
					...(after === undefined ? {} : { after }),
					...(before === undefined ? {} : { before }),
					change:
						before === undefined
							? `added`
							: after === undefined
								? `deleted`
								: `modified`,
					path,
				},
			]
		})
	const baseAssets = new Map(
		(base.assets ?? []).map((asset) => [asset.path, asset]),
	)
	const targetAssets = new Map(
		(target.assets ?? []).map((asset) => [asset.path, asset]),
	)
	const assetChanges = [
		...new Set([...baseAssets.keys(), ...targetAssets.keys()]),
	]
		.toSorted()
		.flatMap((path): readonly SourceUnitChange[] => {
			const assetBefore = baseAssets.get(path)
			const assetAfter = targetAssets.get(path)
			if (
				assetBefore !== undefined &&
				assetAfter !== undefined &&
				assetBefore.byteLength === assetAfter.byteLength &&
				assetBefore.digest === assetAfter.digest
			) {
				return []
			}
			return [
				{
					...(assetAfter === undefined ? {} : { assetAfter }),
					...(assetBefore === undefined ? {} : { assetBefore }),
					change:
						assetBefore === undefined
							? `added`
							: assetAfter === undefined
								? `deleted`
								: `modified`,
					path,
				},
			]
		})
	return [...unitChanges, ...assetChanges].toSorted((a, b) =>
		a.path.localeCompare(b.path),
	)
}

function checkedGroups(
	changes: readonly SourceUnitChange[],
	adapter: SourceVersionControlAdapter,
): readonly SourceChangeGroup[] {
	const groups = adapter.groupChanges(changes)
	const expected = changes.map(({ path }) => path).toSorted()
	const actual = groups
		.flatMap((group) => {
			if (
				group.id.length === 0 ||
				group.kind.length === 0 ||
				group.label.length === 0 ||
				group.paths.length === 0
			) {
				throw new SourceVersionControlError(
					`source.repository_state`,
					`The source adapter returned an invalid semantic change group.`,
				)
			}
			return group.paths.map(validUnitPath)
		})
		.toSorted()
	if (
		actual.length !== new Set(actual).size ||
		JSON.stringify(actual) !== JSON.stringify(expected)
	) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The source adapter did not group every changed path exactly once.`,
		)
	}
	return groups
}

export function createSourceVersionControl(
	projectRootInput: string,
	readWorkingSnapshot: () => Promise<SourceProjectSnapshot>,
	adapter: SourceVersionControlAdapter,
	runtime: SourceVersionControlRuntime = nodeSourceVersionControlRuntime,
): SourceVersionControlService {
	const projectRoot = resolve(projectRootInput)
	let contextPromise: Promise<GitContext> | undefined
	const snapshotCache = new Map<string, Promise<SourceProjectSnapshot>>()
	const context = (): Promise<GitContext> =>
		(contextPromise ??= discoverGitContext(projectRoot, runtime))
	const immutableSnapshot = (
		git: GitContext,
		commit: string,
	): Promise<SourceProjectSnapshot> => {
		let cached = snapshotCache.get(commit)
		if (cached === undefined) {
			cached = snapshotAtCommit(git, commit, adapter, runtime)
			snapshotCache.set(commit, cached)
			if (snapshotCache.size > 4) {
				const oldest = snapshotCache.keys().next().value
				if (oldest !== undefined) snapshotCache.delete(oldest)
			}
		}
		return cached
	}

	const readComparison = async (
		input: ReadSourceComparisonInput,
	): Promise<SourceComparison> => {
		const git = await context()
		const baseCommit = await resolveCommit(git, input.baseRef, runtime)
		const baseSnapshot = await immutableSnapshot(git, baseCommit)
		const targetCommit =
			input.targetRef === undefined
				? undefined
				: await resolveCommit(git, input.targetRef, runtime)
		let targetSnapshot: SourceProjectSnapshot
		if (targetCommit === undefined) {
			try {
				targetSnapshot = await readWorkingSnapshot()
			} catch (error) {
				if (error instanceof SourceVersionControlError) throw error
				throw new SourceVersionControlError(
					`source.repository_state`,
					`The working source snapshot could not be read: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		} else {
			targetSnapshot = await immutableSnapshot(git, targetCommit)
		}
		const changes = sourceUnitChanges(baseSnapshot, targetSnapshot)
		await adapter.validateComparison?.(baseSnapshot, targetSnapshot, changes)
		return {
			base: {
				identity: baseCommit,
				kind: `ref`,
				label: input.baseRef,
				ref: input.baseRef,
				snapshot: baseSnapshot,
			},
			changes: checkedGroups(changes, adapter),
			identity: comparisonIdentity(
				baseCommit,
				targetCommit ?? targetSnapshot.revision,
			),
			target: {
				identity: targetCommit ?? targetSnapshot.revision,
				kind: targetCommit === undefined ? `working` : `ref`,
				label: input.targetRef ?? `Working source`,
				...(input.targetRef === undefined ? {} : { ref: input.targetRef }),
				snapshot: targetSnapshot,
			},
		}
	}

	const commitUnits = async (
		input: CommitSourceUnitsInput,
	): Promise<CommitSourceUnitsResult> => {
		const message = input.message.trim()
		if (message.length === 0) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`Enter a commit message before confirming.`,
			)
		}
		const before = await readComparison({ baseRef: `HEAD` })
		if (before.identity !== input.expectedComparisonIdentity) {
			throw new SourceVersionControlError(
				`source.commit_conflict`,
				`The working source changed after commit review began. Review the refreshed change list and try again.`,
			)
		}
		const allowedGroups = before.changes.filter((group) =>
			group.paths.every((path) => input.paths.includes(path)),
		)
		const allowedPaths = allowedGroups
			.flatMap((group) => group.paths)
			.toSorted()
		const paths = [...new Set(input.paths.map(validUnitPath))].toSorted()
		if (
			paths.length === 0 ||
			JSON.stringify(paths) !== JSON.stringify(allowedPaths)
		) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`The commit selection must contain complete reviewed change groups.`,
			)
		}
		const git = await context()
		const oldHead = await resolveCommit(git, `HEAD`, runtime)
		if (oldHead !== before.base.identity) {
			throw new SourceVersionControlError(
				`source.commit_conflict`,
				`The repository HEAD changed after commit review began. Review the refreshed change list and try again.`,
			)
		}
		const gitDirectory = new TextDecoder()
			.decode(
				(await runGit(git, [`rev-parse`, `--absolute-git-dir`], runtime))
					.stdout,
			)
			.trim()
		const temporaryIndex = resolve(
			gitDirectory,
			`create-art-index-${randomUUID()}`,
		)
		const env = { GIT_INDEX_FILE: temporaryIndex }
		const repositoryPaths = paths.map((path) => repositoryPath(git, path))
		let commit: string
		try {
			await runGit(git, [`read-tree`, oldHead], runtime, { env })
			await runGit(git, [`add`, `-A`, `--`, ...repositoryPaths], runtime, {
				env,
			})
			const tree = new TextDecoder()
				.decode((await runGit(git, [`write-tree`], runtime, { env })).stdout)
				.trim()
			commit = new TextDecoder()
				.decode(
					(
						await runGit(
							git,
							[`commit-tree`, tree, `-p`, oldHead, `-F`, `-`],
							runtime,
							{ env, input: `${message}\n` },
						)
					).stdout,
				)
				.trim()
			await runGit(git, [`update-ref`, `HEAD`, commit, oldHead], runtime)
			await runGit(
				git,
				[`reset`, `--quiet`, commit, `--`, ...repositoryPaths],
				runtime,
			)
		} finally {
			await rm(temporaryIndex, { force: true })
		}
		return {
			commit,
			comparison: await readComparison({ baseRef: `HEAD` }),
		}
	}

	return { commitUnits, readComparison }
}
