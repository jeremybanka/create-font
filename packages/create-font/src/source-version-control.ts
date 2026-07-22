import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

import {
	SourceValidationError,
	SourceVersionControlError,
	type CommitSourceUnitsInput,
	type CommitSourceUnitsResult,
	type JsonValue,
	type ReadSourceComparisonInput,
	type SourceChangeUnit,
	type SourceComparison,
	type SourceProjectSnapshot,
} from "@create-font/server"
import {
	assembleEditorFontSource,
	parseFea,
	parseSourceUnitText,
	sourceUnitKindForPath,
	type SourceDiagnostic,
} from "@create-font/source"

const MAX_SNAPSHOT_UNITS = 2_000
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
const GIT_TIMEOUT_MS = 15_000

type GitContext = Readonly<{
	projectPrefix: string
	repositoryRoot: string
}>

type GitResult = Readonly<{
	stderr: string
	stdout: Uint8Array
}>

function textRevision(text: string): string {
	return `sha256:${createHash(`sha256`).update(text).digest(`hex`)}`
}

function comparisonIdentity(base: string, target: string): string {
	return textRevision(`${base}\0${target}`)
}

function validationIssues(
	errors: readonly [SourceDiagnostic, ...SourceDiagnostic[]],
) {
	return errors.map(({ code, message, path, unitPath }) => ({
		code,
		message,
		path,
		...(unitPath === undefined ? {} : { unitPath }),
	})) as ConstructorParameters<typeof SourceValidationError>[0]
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
	options: Readonly<{
		env?: Readonly<Record<string, string>>
		input?: string
	}> = {},
): Promise<GitResult> {
	const cwd = typeof context === `string` ? context : context.repositoryRoot
	const processHandle = Bun.spawn([`git`, ...args], {
		cwd,
		env: { ...process.env, ...options.env },
		stdin: options.input === undefined ? undefined : new Blob([options.input]),
		stdout: `pipe`,
		stderr: `pipe`,
	})
	const timeout = setTimeout(() => processHandle.kill(), GIT_TIMEOUT_MS)
	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).bytes(),
		new Response(processHandle.stderr).text(),
	]).finally(() => clearTimeout(timeout))
	if (exitCode !== 0) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			stderr.trim() || `Git could not read the font repository.`,
		)
	}
	return { stdout, stderr }
}

async function discoverGitContext(projectRoot: string): Promise<GitContext> {
	let repositoryRoot: string
	try {
		const result = await runGit(projectRoot, [`rev-parse`, `--show-toplevel`])
		repositoryRoot = new TextDecoder().decode(result.stdout).trim()
	} catch (error) {
		throw new SourceVersionControlError(
			`source.git_unavailable`,
			error instanceof Error
				? `Version control is unavailable: ${error.message}`
				: `Version control is unavailable for this font source.`,
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
			`The font project is not contained by its Git repository.`,
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
): Promise<string> {
	try {
		const result = await runGit(context, [
			`rev-parse`,
			`--verify`,
			`--end-of-options`,
			`${validRef(ref)}^{commit}`,
		])
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
): Promise<SourceProjectSnapshot> {
	const pathspec = context.projectPrefix === `` ? `.` : context.projectPrefix
	const listed = await runGit(context, [
		`ls-tree`,
		`-r`,
		`-z`,
		`--name-only`,
		commit,
		`--`,
		pathspec,
	])
	const prefix = context.projectPrefix === `` ? `` : `${context.projectPrefix}/`
	const paths = new TextDecoder()
		.decode(listed.stdout)
		.split(`\0`)
		.filter(Boolean)
		.filter(
			(path) =>
				path.startsWith(prefix) &&
				(path.endsWith(`.json`) ||
					(path.slice(prefix.length).startsWith(`features/`) &&
						path.endsWith(`.fea`))),
		)
		.map((path) => validUnitPath(path.slice(prefix.length)))
		.toSorted()
	if (paths.length === 0) {
		throw new SourceVersionControlError(
			`source.repository_state`,
			`The selected ref does not contain this font project.`,
		)
	}
	if (paths.length > MAX_SNAPSHOT_UNITS) {
		throw new SourceVersionControlError(
			`source.snapshot_too_large`,
			`The selected font snapshot has more than ${MAX_SNAPSHOT_UNITS} source units.`,
		)
	}
	let totalBytes = 0
	const units = []
	const values: Record<string, unknown> = {}
	for (const path of paths) {
		const kind = sourceUnitKindForPath(path)
		const isFeature = path.startsWith(`features/`) && path.endsWith(`.fea`)
		if (kind === null && !isFeature) {
			throw new SourceValidationError([
				{
					code: `directory.unknown_file`,
					message: `Source unit ${JSON.stringify(path)} is not part of the create-font directory contract.`,
					path: `$`,
					unitPath: path,
				},
			])
		}
		const blob = await runGit(context, [
			`show`,
			`--no-textconv`,
			`${commit}:${repositoryPath(context, path)}`,
		])
		totalBytes += blob.stdout.byteLength
		if (totalBytes > MAX_SNAPSHOT_BYTES) {
			throw new SourceVersionControlError(
				`source.snapshot_too_large`,
				`The selected font snapshot exceeds the ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MiB review limit.`,
			)
		}
		const text = new TextDecoder().decode(blob.stdout)
		const parsed = isFeature
			? parseFea(text)
			: parseSourceUnitText(kind!, text, path)
		if (!parsed.ok) {
			if (isFeature) {
				throw new SourceValidationError(
					parsed.errors.map((error) => ({
						code: `source.schema`,
						message: error.message,
						path: `$:${error.range.line}:${error.range.column}`,
						unitPath: path,
					})),
				)
			}
			throw new SourceValidationError(validationIssues(parsed.errors))
		}
		const value = isFeature ? text : parsed.value
		values[path] = value
		units.push({
			path,
			revision: textRevision(text),
			value: value as JsonValue,
		})
	}
	const assembled = assembleEditorFontSource(values)
	if (!assembled.ok)
		throw new SourceValidationError(validationIssues(assembled.errors))
	return { revision: commit, units }
}

function sourceChangeUnits(
	base: SourceProjectSnapshot,
	target: SourceProjectSnapshot,
): readonly SourceChangeUnit[] {
	const baseByPath = new Map(base.units.map((unit) => [unit.path, unit]))
	const targetByPath = new Map(target.units.map((unit) => [unit.path, unit]))
	const paths = new Set([...baseByPath.keys(), ...targetByPath.keys()])
	return [...paths].toSorted().flatMap((path): readonly SourceChangeUnit[] => {
		const before = baseByPath.get(path)
		const after = targetByPath.get(path)
		if (
			before !== undefined &&
			after !== undefined &&
			JSON.stringify(before.value) === JSON.stringify(after.value)
		)
			return []
		const value = after?.value ?? before?.value
		const record =
			typeof value === `object` && value !== null && !Array.isArray(value)
				? (value as Readonly<Record<string, JsonValue>>)
				: undefined
		const glyph = path.startsWith(`glyphs/`) && path !== `glyphs/index.json`
		const id =
			typeof record?.id === `string`
				? record.id
				: glyph
					? `glyph:${path}`
					: `source:${path}`
		const label = glyph && typeof record?.name === `string` ? record.name : path
		return [
			{
				change:
					before === undefined
						? `added`
						: after === undefined
							? `deleted`
							: `modified`,
				id,
				kind: glyph ? `glyph` : `source`,
				label,
				paths: [path],
			},
		]
	})
}

export function createSourceVersionControl(
	projectRoot: string,
	readWorkingSnapshot: () => Promise<SourceProjectSnapshot>,
) {
	let contextPromise: Promise<GitContext> | undefined
	const snapshotCache = new Map<string, Promise<SourceProjectSnapshot>>()
	const context = (): Promise<GitContext> =>
		(contextPromise ??= discoverGitContext(projectRoot))
	const immutableSnapshot = (
		git: GitContext,
		commit: string,
	): Promise<SourceProjectSnapshot> => {
		let cached = snapshotCache.get(commit)
		if (cached === undefined) {
			cached = snapshotAtCommit(git, commit)
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
		const baseCommit = await resolveCommit(git, input.baseRef)
		const baseSnapshot = await immutableSnapshot(git, baseCommit)
		const targetCommit =
			input.targetRef === undefined
				? undefined
				: await resolveCommit(git, input.targetRef)
		const targetSnapshot =
			targetCommit === undefined
				? await readWorkingSnapshot()
				: await immutableSnapshot(git, targetCommit)
		const identity = comparisonIdentity(
			baseCommit,
			targetCommit ?? targetSnapshot.revision,
		)
		return {
			base: {
				identity: baseCommit,
				kind: `ref`,
				label: input.baseRef,
				ref: input.baseRef,
				snapshot: baseSnapshot,
			},
			changes: sourceChangeUnits(baseSnapshot, targetSnapshot),
			identity,
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
		const allowedPaths = new Set(
			before.changes.flatMap((change) => change.paths),
		)
		const paths = [...new Set(input.paths.map(validUnitPath))]
		if (paths.some((path) => !allowedPaths.has(path))) {
			throw new SourceVersionControlError(
				`source.repository_state`,
				`The commit selection contains a path outside the reviewed source changes.`,
			)
		}
		const git = await context()
		const oldHead = await resolveCommit(git, `HEAD`)
		const gitDirectoryText = new TextDecoder().decode(
			(await runGit(git, [`rev-parse`, `--absolute-git-dir`])).stdout,
		)
		const temporaryIndex = resolve(
			gitDirectoryText.trim(),
			`create-font-index-${randomUUID()}`,
		)
		const env = { GIT_INDEX_FILE: temporaryIndex }
		const repoPaths = paths.map((path) => repositoryPath(git, path))
		let commit: string
		try {
			await runGit(git, [`read-tree`, oldHead], { env })
			await runGit(git, [`add`, `-A`, `--`, ...repoPaths], { env })
			const tree = new TextDecoder()
				.decode((await runGit(git, [`write-tree`], { env })).stdout)
				.trim()
			commit = new TextDecoder()
				.decode(
					(
						await runGit(git, [`commit-tree`, tree, `-p`, oldHead, `-F`, `-`], {
							env,
							input: `${message}\n`,
						})
					).stdout,
				)
				.trim()
			await runGit(git, [`update-ref`, `HEAD`, commit, oldHead])
			await runGit(git, [`reset`, `--quiet`, commit, `--`, ...repoPaths])
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
