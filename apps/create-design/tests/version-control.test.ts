import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import {
	defaultObjectUnitPath,
	defaultTextContentUnitPath,
	splitDesignDocument,
	type DesignSourceDirectoryFiles,
} from "@create-design/source"
import { sourceSyncStateFromSnapshot } from "@create-art/source-rpc"
import type {
	JsonValue,
	SourceAssetDescriptor,
	SourceAssetService,
	SourceService,
} from "@create-art/source-rpc"
import { afterEach, describe, expect, it } from "vitest"

import { createInitialDocument } from "@create-design/source"
import { createDesignSourceService } from "../src/source-service.ts"
import { designSourceTransaction } from "../src/source-sync.ts"
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

async function gitBytes(
	root: string,
	...args: readonly string[]
): Promise<Uint8Array> {
	const { stdout } = await execFileAsync(`git`, args, {
		cwd: root,
		encoding: null,
	})
	return new Uint8Array(stdout)
}

function digest(bytes: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash(`sha256`).update(bytes).digest(`hex`)}`
}

function descriptor(
	bytes: Uint8Array,
	overrides: Partial<SourceAssetDescriptor> = {},
): SourceAssetDescriptor {
	return {
		byteLength: bytes.byteLength,
		digest: digest(bytes),
		id: `asset:test`,
		mediaType: `application/octet-stream`,
		path: `assets/test.bin`,
		...overrides,
	}
}

function assetIndexValue(assets: readonly SourceAssetDescriptor[]): JsonValue {
	return {
		entries: assets.map((asset) => ({
			byteLength: asset.byteLength,
			id: asset.id,
			mediaType: asset.mediaType,
			path: asset.path,
			sha256: asset.digest.slice(`sha256:`.length),
		})),
		format: `create-design.asset-index`,
		version: 1,
	}
}

function fontIndexValue(
	fonts: readonly SourceAssetDescriptor[],
	family = `Test Sans`,
): JsonValue {
	return {
		entries: fonts.map((font) => ({
			byteLength: font.byteLength,
			family,
			id: font.id,
			mediaType: font.mediaType,
			path: font.path,
			revision: font.digest,
			sha256: font.digest.slice(`sha256:`.length),
		})),
		format: `create-design.font-index`,
		version: 1,
	}
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes)
			controller.close()
		},
	})
}

async function stage(
	source: SourceAssetService,
	asset: SourceAssetDescriptor,
	bytes: Uint8Array,
	operationId: string,
) {
	return source.stageAsset({
		bytes: byteStream(bytes),
		descriptor: asset,
		operationId,
	})
}

async function addAsset(
	source: SourceService & SourceAssetService,
	asset: SourceAssetDescriptor,
	bytes: Uint8Array,
	operationId: string,
) {
	const index = await source.readUnit(`assets/index.json`)
	const staged = await stage(source, asset, bytes, operationId)
	return source.writeAssets({
		assetWrites: [{ expectedDigest: null, stagingToken: staged.stagingToken }],
		idempotencyKey: operationId,
		writes: [
			{
				expectedRevision: index.revision,
				path: index.path,
				value: assetIndexValue([asset]),
			},
		],
	})
}

async function addFont(
	source: SourceService & SourceAssetService,
	font: SourceAssetDescriptor,
	bytes: Uint8Array,
	operationId: string,
) {
	const index = await source.readUnit(`fonts/index.json`)
	const staged = await stage(source, font, bytes, operationId)
	return source.writeAssets({
		assetWrites: [{ expectedDigest: null, stagingToken: staged.stagingToken }],
		idempotencyKey: operationId,
		writes: [
			{
				expectedRevision: index.revision,
				path: index.path,
				value: fontIndexValue([font]),
			},
		],
	})
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
	it(`labels an isolated layer metadata change by stable layer identity`, async () => {
		const { source, versionControl } = await fixture()
		const path = `scene/layers/artwork.json`
		const layer = await source.readUnit(path)
		await source.writeUnit({
			expectedRevision: layer.revision,
			idempotencyKey: `rename-layer`,
			path,
			value: {
				...(layer.value as Record<string, JsonValue>),
				name: `Presentation`,
			},
		})

		expect(
			(await versionControl.readComparison({ baseRef: `HEAD` })).changes,
		).toEqual([
			expect.objectContaining({
				id: `layer:artwork`,
				kind: `structure`,
				label: `Layer · Presentation`,
				paths: [path],
			}),
		])
	})

	it(`groups raw text with its object and rejects partial text commits`, async () => {
		const { source, versionControl } = await fixture()
		const initial = createInitialDocument()
		const textObject = {
			id: `object:review-text`,
			name: `Review text`,
			geometry: {
				kind: `text` as const,
				mode: `area` as const,
				text: `﻿Unicode 😀\r\nterminal\n`,
				typography: {
					font: { id: `font:test`, family: `Test` },
					size: 24,
					leading: 30,
					tracking: 0,
					kerning: `auto` as const,
					alignment: `start` as const,
					direction: `auto` as const,
				},
				x: 20,
				y: 30,
				frame: {
					width: 200,
					height: 100,
					inset: { top: 4, right: 4, bottom: 4, left: 4 },
					verticalAlignment: `top` as const,
				},
			},
			transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
			appearance: { fill: { swatchId: initial.swatches[1]!.id } },
		}
		const snapshot = await source.readSnapshot()
		await source.writeUnits({
			idempotencyKey: `add-review-text`,
			...designSourceTransaction(sourceSyncStateFromSnapshot(snapshot), {
				...initial,
				objects: [...initial.objects, textObject],
				layers: initial.layers.map((layer) => ({
					...layer,
					children: [
						...layer.children,
						{ kind: `object` as const, id: textObject.id },
					],
				})),
			}),
		})
		const objectPath = defaultObjectUnitPath(textObject.id)
		const contentPath = defaultTextContentUnitPath(textObject.id)
		let comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		const structural = comparison.changes.find(
			({ id }) => id === `design:coordinated-structure`,
		)
		expect(structural?.paths).toEqual(
			expect.arrayContaining([objectPath, contentPath]),
		)
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: comparison.identity,
				message: `Reject partial text addition`,
				paths: [contentPath],
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
		await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Add text`,
			paths: comparison.changes.flatMap(({ paths }) => paths) as [
				string,
				...string[],
			],
		})
		expect(
			(await versionControl.readComparison({ baseRef: `HEAD` })).changes,
		).toEqual([])

		const currentContent = await source.readUnit(contentPath)
		const currentObject = await source.readUnit(objectPath)
		await source.writeUnits({
			idempotencyKey: `edit-review-text`,
			writes: [
				{
					expectedRevision: currentObject.revision,
					path: objectPath,
					value: {
						...(currentObject.value as Record<string, JsonValue>),
						name: `Edited review text`,
					},
				},
				{
					expectedRevision: currentContent.revision,
					path: contentPath,
					value: `Narrow raw diff\n`,
				},
			],
		})
		comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				kind: `text`,
				label: `Edited review text`,
				paths: [objectPath, contentPath].toSorted(),
			}),
		])
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: comparison.identity,
				message: `Reject partial text edit`,
				paths: [objectPath],
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})

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
			layers: initial.layers.map((layer) => ({
				...layer,
				children: [
					...layer.children,
					{ kind: `object` as const, id: added.id },
				],
			})),
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

	it(`reviews and commits a binary asset with its index atomically`, async () => {
		const { designRoot, source, versionControl, workspaceRoot } =
			await fixture()
		const bytes = new Uint8Array([0, 255, 128, 10, 3, 1])
		const asset = descriptor(bytes)
		await addAsset(source, asset, bytes, `add-reviewed-asset`)
		await writeFile(join(workspaceRoot, `notes.txt`), `staged note\n`)
		await git(workspaceRoot, `add`, `notes.txt`)
		await writeFile(join(workspaceRoot, `scratch.txt`), `untracked\n`)

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				id: `design:assets`,
				kind: `asset`,
				label: `Assets`,
				paths: [`assets/index.json`, asset.path],
			}),
		])
		for (const path of [`assets/index.json`, asset.path] as const) {
			await expect(
				versionControl.commitUnits({
					expectedComparisonIdentity: comparison.identity,
					message: `Invalid partial asset`,
					paths: [path],
				}),
			).rejects.toMatchObject({ code: `source.repository_state` })
		}

		const committed = await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Add reviewed binary asset`,
			paths: [`assets/index.json`, asset.path],
		})
		expect(
			await gitBytes(workspaceRoot, `show`, `HEAD:design/${asset.path}`),
		).toEqual(bytes)
		expect(await git(workspaceRoot, `diff`, `--cached`, `--name-only`)).toBe(
			`notes.txt`,
		)
		expect(await git(workspaceRoot, `status`, `--short`, `scratch.txt`)).toBe(
			`?? scratch.txt`,
		)
		expect(committed.comparison.changes).toEqual([])
		expect(
			new Uint8Array(await readFile(join(designRoot, asset.path))),
		).toEqual(bytes)
	})

	it(`keeps simultaneous assets in one shared-index review group`, async () => {
		const { source, versionControl } = await fixture()
		const firstBytes = new Uint8Array([0, 255, 1])
		const secondBytes = new Uint8Array([128, 2, 254, 3])
		const first = descriptor(firstBytes, {
			id: `asset:first`,
			path: `assets/first.bin`,
		})
		const second = descriptor(secondBytes, {
			id: `asset:second`,
			path: `assets/second.bin`,
		})
		const index = await source.readUnit(`assets/index.json`)
		const firstStage = await stage(source, first, firstBytes, `add-two-assets`)
		const secondStage = await stage(
			source,
			second,
			secondBytes,
			`add-two-assets`,
		)
		await source.writeAssets({
			assetWrites: [
				{ expectedDigest: null, stagingToken: firstStage.stagingToken },
				{ expectedDigest: null, stagingToken: secondStage.stagingToken },
			],
			idempotencyKey: `add-two-assets`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: assetIndexValue([first, second]),
				},
			],
		})

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				id: `design:assets`,
				paths: [`assets/first.bin`, `assets/index.json`, `assets/second.bin`],
			}),
		])
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: comparison.identity,
				message: `Invalid one-asset selection`,
				paths: [`assets/index.json`, first.path],
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})

	it(`reviews a font as one Fonts group and selectively commits its inventory and bytes`, async () => {
		const { designRoot, source, versionControl, workspaceRoot } =
			await fixture()
		const bytes = new Uint8Array([79, 84, 84, 79, 0, 1, 2, 3])
		const font = descriptor(bytes, {
			id: `font:test-sans`,
			mediaType: `font/otf`,
			path: `fonts/test-sans.otf`,
		})
		await addFont(source, font, bytes, `add-reviewed-font`)

		const comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				change: `modified`,
				id: `design:fonts`,
				kind: `font`,
				label: `Fonts`,
				paths: [`fonts/index.json`, font.path],
			}),
		])
		for (const path of [`fonts/index.json`, font.path] as const) {
			await expect(
				versionControl.commitUnits({
					expectedComparisonIdentity: comparison.identity,
					message: `Invalid partial font`,
					paths: [path],
				}),
			).rejects.toMatchObject({ code: `source.repository_state` })
		}

		const committed = await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Add reviewed font`,
			paths: [`fonts/index.json`, font.path],
		})
		expect(
			await gitBytes(workspaceRoot, `show`, `HEAD:design/${font.path}`),
		).toEqual(bytes)
		expect(committed.comparison.changes).toEqual([])
		expect(
			await versionControl.readComparison({ baseRef: `HEAD` }),
		).toMatchObject({ changes: [] })
		expect(await readFile(join(designRoot, font.path))).toEqual(
			Buffer.from(bytes),
		)
		expect(
			await readdir(join(designRoot, `.create-design`, `asset-staging`)),
		).toEqual([])
	})

	it(`tracks font metadata and removal while rejecting tampered or missing bytes`, async () => {
		const { designRoot, source, versionControl } = await fixture()
		const bytes = new Uint8Array([79, 84, 84, 79, 4, 5, 6, 7])
		const font = descriptor(bytes, {
			id: `font:lifecycle`,
			mediaType: `font/otf`,
			path: `fonts/lifecycle.otf`,
		})
		await addFont(source, font, bytes, `add-lifecycle-font`)
		let comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Add lifecycle font`,
			paths: [`fonts/index.json`, font.path],
		})

		let index = await source.readUnit(`fonts/index.json`)
		await source.writeUnit({
			expectedRevision: index.revision,
			idempotencyKey: `rename-font-family`,
			path: index.path,
			value: fontIndexValue([font], `Renamed Sans`),
		})
		comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				change: `modified`,
				id: `design:fonts`,
				paths: [`fonts/index.json`],
			}),
		])
		await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Rename font family`,
			paths: [`fonts/index.json`],
		})

		await writeFile(join(designRoot, font.path), new Uint8Array(bytes.length))
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.repository_state` })
		await writeFile(join(designRoot, font.path), bytes)
		await rm(join(designRoot, font.path))
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.repository_state` })

		await writeFile(join(designRoot, font.path), bytes)
		index = await source.readUnit(`fonts/index.json`)
		await source.writeAssets({
			assetRemovals: [{ expectedDigest: font.digest, path: font.path }],
			assetWrites: [],
			idempotencyKey: `remove-lifecycle-font`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: fontIndexValue([]),
				},
			],
		})
		comparison = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(comparison.changes).toEqual([
			expect.objectContaining({
				change: `modified`,
				id: `design:fonts`,
				paths: [`fonts/index.json`, font.path],
			}),
		])
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: comparison.identity,
				message: `Invalid partial font removal`,
				paths: [`fonts/index.json`],
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
		const removed = await versionControl.commitUnits({
			expectedComparisonIdentity: comparison.identity,
			message: `Remove lifecycle font`,
			paths: [`fonts/index.json`, font.path],
		})
		expect(removed.comparison.changes).toEqual([])
	})

	it(`tracks binary replacement and deletion and rejects a stale asset review`, async () => {
		const { source, versionControl } = await fixture()
		const initialBytes = new Uint8Array([255, 0, 128, 1])
		const initialAsset = descriptor(initialBytes)
		await addAsset(source, initialAsset, initialBytes, `add-lifecycle-asset`)
		const added = await versionControl.readComparison({ baseRef: `HEAD` })
		const firstCommit = await versionControl.commitUnits({
			expectedComparisonIdentity: added.identity,
			message: `Add lifecycle asset`,
			paths: [`assets/index.json`, initialAsset.path],
		})

		const replacementBytes = new Uint8Array([0, 254, 129, 2, 3])
		const replacement = descriptor(replacementBytes)
		let index = await source.readUnit(`assets/index.json`)
		let staged = await stage(
			source,
			replacement,
			replacementBytes,
			`replace-lifecycle-asset`,
		)
		await source.writeAssets({
			assetWrites: [
				{
					expectedDigest: initialAsset.digest,
					stagingToken: staged.stagingToken,
				},
			],
			idempotencyKey: `replace-lifecycle-asset`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: assetIndexValue([replacement]),
				},
			],
		})
		const reviewed = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(reviewed.changes[0]?.paths).toEqual([
			`assets/index.json`,
			initialAsset.path,
		])

		const laterBytes = new Uint8Array([1, 253, 130, 3, 4, 5])
		const later = descriptor(laterBytes)
		index = await source.readUnit(`assets/index.json`)
		staged = await stage(source, later, laterBytes, `replace-after-review`)
		await source.writeAssets({
			assetWrites: [
				{
					expectedDigest: replacement.digest,
					stagingToken: staged.stagingToken,
				},
			],
			idempotencyKey: `replace-after-review`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: assetIndexValue([later]),
				},
			],
		})
		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: reviewed.identity,
				message: `Stale binary replacement`,
				paths: [`assets/index.json`, later.path],
			}),
		).rejects.toMatchObject({ code: `source.commit_conflict` })

		const fresh = await versionControl.readComparison({ baseRef: `HEAD` })
		const secondCommit = await versionControl.commitUnits({
			expectedComparisonIdentity: fresh.identity,
			message: `Replace lifecycle asset`,
			paths: [`assets/index.json`, later.path],
		})
		const refs = await versionControl.readComparison({
			baseRef: firstCommit.commit,
			targetRef: secondCommit.commit,
		})
		expect(refs.base.snapshot.assets).toEqual([initialAsset])
		expect(refs.target.snapshot.assets).toEqual([later])
		expect(refs.changes[0]?.paths).toEqual([`assets/index.json`, later.path])

		index = await source.readUnit(`assets/index.json`)
		await source.writeAssets({
			assetRemovals: [{ expectedDigest: later.digest, path: later.path }],
			assetWrites: [],
			idempotencyKey: `delete-lifecycle-asset`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: assetIndexValue([]),
				},
			],
		})
		const deleted = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(deleted.changes[0]?.paths).toEqual([`assets/index.json`, later.path])
		expect(deleted.changes[0]?.change).toBe(`modified`)
	})

	it(`allows metadata-only review and rejects incoherent binary or index edits`, async () => {
		const { designRoot, source, versionControl } = await fixture()
		const bytes = new Uint8Array([0, 255, 9, 8])
		const asset = descriptor(bytes)
		await addAsset(source, asset, bytes, `add-metadata-asset`)
		const added = await versionControl.readComparison({ baseRef: `HEAD` })
		await versionControl.commitUnits({
			expectedComparisonIdentity: added.identity,
			message: `Add metadata asset`,
			paths: [`assets/index.json`, asset.path],
		})

		const metadata = { ...asset, mediaType: `image/png` }
		let index = await source.readUnit(`assets/index.json`)
		const staged = await stage(source, metadata, bytes, `update-asset-metadata`)
		await source.writeAssets({
			assetWrites: [
				{ expectedDigest: asset.digest, stagingToken: staged.stagingToken },
			],
			idempotencyKey: `update-asset-metadata`,
			writes: [
				{
					expectedRevision: index.revision,
					path: index.path,
					value: assetIndexValue([metadata]),
				},
			],
		})
		const metadataReview = await versionControl.readComparison({
			baseRef: `HEAD`,
		})
		expect(metadataReview.changes).toEqual([
			expect.objectContaining({
				id: `design:assets`,
				paths: [`assets/index.json`],
			}),
		])
		await versionControl.commitUnits({
			expectedComparisonIdentity: metadataReview.identity,
			message: `Update asset media type`,
			paths: [`assets/index.json`],
		})

		await writeFile(
			join(designRoot, asset.path),
			new Uint8Array([1, 254, 10, 7]),
		)
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.repository_state` })

		await writeFile(join(designRoot, asset.path), bytes)
		index = await source.readUnit(`assets/index.json`)
		await writeFile(
			join(designRoot, index.path),
			`${JSON.stringify(
				assetIndexValue([{ ...metadata, digest: `sha256:${`0`.repeat(64)}` }]),
			)}\n`,
		)
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})
})
