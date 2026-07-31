import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import {
	defaultObjectUnitPath,
	splitDesignDocument,
	type DesignSourceDirectoryFiles,
} from "@create-design/source"
import type { JsonValue } from "@create-art/source-rpc"
import { afterEach, describe, expect, it } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { createDesignSourceService } from "../src/source-service.ts"
import { createDesignSourceVersionControl } from "../src/version-control.ts"

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

async function git(root: string, ...args: readonly string[]): Promise<string> {
	const { stdout } = await execFileAsync(`git`, args, {
		cwd: root,
		encoding: `utf8`,
	})
	return stdout.trim()
}

async function fixture() {
	const workspaceRoot = await mkdtemp(join(tmpdir(), `create-design-git-`))
	temporaryRoots.push(workspaceRoot)
	const designRoot = join(workspaceRoot, `design`)
	const source = await createDesignSourceService(designRoot)
	await writeFile(join(workspaceRoot, `notes.txt`), `initial\n`)
	await git(workspaceRoot, `init`, `--initial-branch=main`)
	await git(workspaceRoot, `config`, `user.name`, `Create Design Test`)
	await git(workspaceRoot, `config`, `user.email`, `create-design@test.local`)
	await git(workspaceRoot, `add`, `design`, `notes.txt`)
	await git(workspaceRoot, `commit`, `-m`, `Initial design`)
	return {
		designRoot,
		source,
		versionControl: createDesignSourceVersionControl(designRoot, source),
		workspaceRoot,
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe(`create-design version control`, () => {
	it(`labels standalone object changes with stable design identity`, async () => {
		const { source, versionControl } = await fixture()
		const objectPath = defaultObjectUnitPath(`object:coral`)
		const object = await source.readUnit(objectPath)
		await source.writeUnit({
			expectedRevision: object.revision,
			idempotencyKey: `rename-object`,
			path: objectPath,
			value: {
				...(object.value as Record<string, unknown>),
				name: `Hero rectangle`,
			},
		})

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				id: `object:coral`,
				kind: `object`,
				label: `Hero rectangle`,
				paths: [objectPath],
			}),
		])
	})

	it(`makes multi-file object additions one non-partially-selectable group`, async () => {
		const { source, versionControl } = await fixture()
		const before = await source.readSnapshot()
		const initial = createInitialDocument()
		const added = {
			...initial.objects[0]!,
			id: `object:added`,
			name: `Added mark`,
		}
		const split = splitDesignDocument({
			...initial,
			objects: [...initial.objects, added],
		})
		if (!split.ok) throw new Error(split.errors[0].message)
		const values = split.value as DesignSourceDirectoryFiles
		const paths = [
			`scene/layers/artwork.json`,
			`scene/objects/index.json`,
			defaultObjectUnitPath(added.id),
		] as const
		const revisions = new Map(
			before.units.map(({ path, revision }) => [path, revision]),
		)
		await source.writeUnits({
			idempotencyKey: `add-object`,
			writes: paths.map((path) => ({
				expectedRevision: revisions.get(path) ?? null,
				path,
				value: values[path] as JsonValue,
			})),
		})

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				id: `design:coordinated-structure`,
				kind: `structure`,
				paths: [...paths].toSorted(),
			}),
		])
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: comparison.identity,
				message: `Invalid partial addition`,
				paths: [paths[2]],
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})

	it(`keeps an indexed object path move atomic`, async () => {
		const { source, versionControl } = await fixture()
		const previousPath = defaultObjectUnitPath(`object:coral`)
		const nextPath = `scene/objects/brand/coral.json`
		const object = await source.readUnit(previousPath)
		const index = await source.readUnit(`scene/objects/index.json`)
		const indexValue = index.value as {
			entries: readonly Readonly<{ id: string; path: string }>[]
		}
		await source.writeUnits({
			idempotencyKey: `move-object-source`,
			removals: [{ expectedRevision: object.revision, path: previousPath }],
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: {
						...(index.value as Record<string, JsonValue>),
						entries: indexValue.entries.map((entry) =>
							entry.id === `object:coral`
								? { ...entry, path: nextPath }
								: entry,
						),
					},
				},
				{
					expectedRevision: null,
					path: nextPath,
					value: object.value,
				},
			],
		})

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				id: `design:coordinated-structure`,
				paths: [previousPath, nextPath, `scene/objects/index.json`].toSorted(),
			}),
		])
	})

	it(`commits selected design paths while preserving unrelated repository work`, async () => {
		const { source, versionControl, workspaceRoot } = await fixture()
		const document = await source.readUnit(`document.json`)
		await source.writeUnit({
			expectedRevision: document.revision,
			idempotencyKey: `rename-design`,
			path: document.path,
			value: {
				...(document.value as Record<string, unknown>),
				title: `Committed title`,
			},
		})
		await writeFile(join(workspaceRoot, `notes.txt`), `staged note\n`)
		await git(workspaceRoot, `add`, `notes.txt`)
		await writeFile(join(workspaceRoot, `scratch.txt`), `untracked\n`)
		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })

		const result = await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Rename design`,
			paths: [`document.json`],
		})

		expect(
			await git(workspaceRoot, `show`, `HEAD:design/document.json`),
		).toContain(`Committed title`)
		expect(await git(workspaceRoot, `diff`, `--cached`, `--name-only`)).toBe(
			`notes.txt`,
		)
		expect(await git(workspaceRoot, `status`, `--short`, `scratch.txt`)).toBe(
			`?? scratch.txt`,
		)
		expect(result.comparison.changes).toEqual([])
		expect(await readFile(join(workspaceRoot, `notes.txt`), `utf8`)).toBe(
			`staged note\n`,
		)
	})
})
