import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { SourceAssetDescriptor } from "../src/assets.ts"
import { SourceVersionControlError, type JsonValue } from "../src/contracts.ts"
import { createFileSystemSourceService } from "../src/node.ts"
import {
	createSourceVersionControl,
	type SourceVersionControlAdapter,
	type SourceVersionControlRuntime,
} from "../src/version-control.ts"
import { createSourceRpc } from "../src/server.ts"

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

async function git(root: string, ...args: readonly string[]): Promise<string> {
	const { stdout } = await execFileAsync(`git`, args, {
		cwd: root,
		encoding: `utf8`,
	})
	return stdout.trim()
}

function revision(value: unknown): string {
	return `sha256:${createHash(`sha256`).update(JSON.stringify(value)).digest(`hex`)}`
}

function assetDigest(bytes: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash(`sha256`).update(bytes).digest(`hex`)}`
}

const adapter: SourceVersionControlAdapter = {
	groupChanges(changes) {
		return changes.map((change) => ({
			change: change.change,
			id: `test:${change.path}`,
			kind: `test`,
			label: change.path,
			paths: [change.path],
		}))
	},
	includesPath: (path) => path.endsWith(`.json`),
	parseUnit: (_path, text) => JSON.parse(text) as JsonValue,
	validateSnapshot: () => undefined,
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), `source-version-control-`))
	temporaryRoots.push(root)
	const sourceRoot = join(root, `source`)
	await mkdir(sourceRoot)
	await writeFile(join(sourceRoot, `a.json`), `{"value":"a"}\n`)
	await writeFile(join(sourceRoot, `b.json`), `{"value":"b"}\n`)
	await git(root, `init`, `--initial-branch=main`)
	await git(root, `config`, `user.name`, `Source RPC Test`)
	await git(root, `config`, `user.email`, `source-rpc@test.local`)
	await git(root, `add`, `source`)
	await git(root, `commit`, `-m`, `Initial source`)
	const service = await createFileSystemSourceService(sourceRoot, {
		assemble: () => ({ ok: true, value: undefined }),
		format: (_kind, value) => ({
			ok: true,
			value: `${JSON.stringify(value)}\n`,
		}),
		kindForPath: (path) => (path.endsWith(`.json`) ? `json` : null),
		parse: (_kind, text) => ({
			ok: true,
			value: JSON.parse(text) as JsonValue,
		}),
	})
	return {
		root,
		service,
		sourceRoot,
		versionControl: createSourceVersionControl(
			sourceRoot,
			() => service.readSnapshot(),
			adapter,
		),
	}
}

function assetIndex(descriptor: SourceAssetDescriptor): JsonValue {
	return { assets: [descriptor] }
}

function descriptors(values: Readonly<Record<string, JsonValue>>) {
	const value = values[`assets.json`] as {
		assets?: readonly SourceAssetDescriptor[]
	}
	return value.assets ?? []
}

async function assetFixture() {
	const root = await mkdtemp(join(tmpdir(), `source-version-control-asset-`))
	temporaryRoots.push(root)
	const sourceRoot = join(root, `source`)
	await mkdir(sourceRoot)
	const bytes = new Uint8Array([0, 255, 128, 10, 1])
	const descriptor: SourceAssetDescriptor = {
		byteLength: bytes.byteLength,
		digest: assetDigest(bytes),
		id: `asset:binary`,
		mediaType: `application/octet-stream`,
		path: `binary/data.bin`,
	}
	await mkdir(join(sourceRoot, `binary`))
	await writeFile(join(sourceRoot, descriptor.path), bytes)
	await writeFile(
		join(sourceRoot, `assets.json`),
		`${JSON.stringify(assetIndex(descriptor))}\n`,
	)
	await git(root, `init`, `--initial-branch=main`)
	await git(root, `config`, `user.name`, `Source RPC Test`)
	await git(root, `config`, `user.email`, `source-rpc@test.local`)
	await git(root, `add`, `source`)
	await git(root, `commit`, `-m`, `Initial binary source`)
	const codec = {
		assets: {
			descriptors: (values: Readonly<Record<string, JsonValue>>) => ({
				ok: true as const,
				value: descriptors(values),
			}),
			isPath: (path: string) => path.endsWith(`.bin`),
		},
		assemble: () => ({ ok: true as const, value: undefined }),
		format: (_kind: string, value: JsonValue) => ({
			ok: true as const,
			value: `${JSON.stringify(value)}\n`,
		}),
		kindForPath: (path: string) => (path.endsWith(`.json`) ? `json` : null),
		parse: (_kind: string, text: string) => ({
			ok: true as const,
			value: JSON.parse(text) as JsonValue,
		}),
	}
	const service = await createFileSystemSourceService(sourceRoot, codec)
	const assetAdapter: SourceVersionControlAdapter = {
		...adapter,
		assets: {
			descriptors,
			isPath: codec.assets.isPath,
		},
	}
	return {
		bytes,
		descriptor,
		root,
		service,
		sourceRoot,
		versionControl: createSourceVersionControl(
			sourceRoot,
			() => service.readSnapshot(),
			assetAdapter,
		),
	}
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

describe(`Git source version control`, () => {
	it(`exposes product-neutral comparison and commit RPC`, async () => {
		const comparison = {
			base: {
				identity: `commit-a`,
				kind: `ref` as const,
				label: `HEAD`,
				ref: `HEAD`,
				snapshot: { revision: `commit-a`, units: [] },
			},
			changes: [],
			identity: `comparison-a`,
			target: {
				identity: `working-a`,
				kind: `working` as const,
				label: `Working source`,
				snapshot: { revision: `working-a`, units: [] },
			},
		}
		const versionControl = {
			commitUnits: vi.fn(async () => ({
				commit: `commit-b`,
				comparison,
			})),
			readComparison: vi.fn(async () => comparison),
		}
		const app = createSourceRpc({ versionControl })
		const response = await app.handle(
			new Request(
				`http://localhost/source/comparison?baseRef=HEAD&targetRef=main`,
			),
		)
		expect(response.status).toBe(200)
		expect(versionControl.readComparison).toHaveBeenCalledWith({
			baseRef: `HEAD`,
			targetRef: `main`,
		})

		const committed = await app.handle(
			new Request(`http://localhost/source/commit`, {
				body: JSON.stringify({
					expectedComparisonIdentity: comparison.identity,
					message: `Commit selected source`,
					paths: [`document.json`],
				}),
				headers: { "content-type": `application/json` },
				method: `POST`,
			}),
		)
		expect(committed.status).toBe(200)
		expect(versionControl.commitUnits).toHaveBeenCalledWith({
			expectedComparisonIdentity: comparison.identity,
			message: `Commit selected source`,
			paths: [`document.json`],
		})

		const errorApp = createSourceRpc({
			versionControl: {
				commitUnits: async () => {
					throw new SourceVersionControlError(
						`source.commit_conflict`,
						`Review is stale.`,
					)
				},
				readComparison: async () => {
					throw new SourceVersionControlError(
						`source.invalid_ref`,
						`Ref is invalid.`,
					)
				},
			},
		})
		const invalidRef = await errorApp.handle(
			new Request(`http://localhost/source/comparison?baseRef=missing`),
		)
		expect(invalidRef.status).toBe(422)
		expect(await invalidRef.json()).toMatchObject({
			code: `source.invalid_ref`,
		})
		const staleCommit = await errorApp.handle(
			new Request(`http://localhost/source/commit`, {
				body: JSON.stringify({
					expectedComparisonIdentity: comparison.identity,
					message: `Stale`,
					paths: [`document.json`],
				}),
				headers: { "content-type": `application/json` },
				method: `POST`,
			}),
		)
		expect(staleCommit.status).toBe(409)
		expect(await staleCommit.json()).toMatchObject({
			code: `source.commit_conflict`,
		})
	})

	it(`compares immutable refs and the complete live workspace`, async () => {
		const { root, sourceRoot, versionControl } = await fixture()
		const initial = await git(root, `rev-parse`, `HEAD`)
		await writeFile(join(sourceRoot, `a.json`), `{"value":"working"}\n`)
		await writeFile(join(sourceRoot, `b.json`), `{"value":"staged"}\n`)
		await git(root, `add`, `source/b.json`)
		await writeFile(join(sourceRoot, `c.json`), `{"value":"untracked"}\n`)

		const working = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(working.changes.map(({ paths }) => paths[0])).toEqual([
			`a.json`,
			`b.json`,
			`c.json`,
		])

		await git(root, `add`, `source/a.json`)
		await git(root, `commit`, `-m`, `Second source`)
		const second = await git(root, `rev-parse`, `HEAD`)
		const refComparison = await versionControl.readComparison({
			baseRef: initial,
			targetRef: second,
		})
		await writeFile(join(sourceRoot, `a.json`), `{"value":"later"}\n`)
		expect(
			await versionControl.readComparison({
				baseRef: initial,
				targetRef: second,
			}),
		).toEqual(refComparison)
	})

	it(`compares non-UTF8 binary assets across refs and the working source`, async () => {
		const { descriptor, root, sourceRoot, versionControl } =
			await assetFixture()
		const initial = await git(root, `rev-parse`, `HEAD`)
		const secondBytes = new Uint8Array([255, 0, 254, 129, 10, 2])
		const second = {
			...descriptor,
			byteLength: secondBytes.byteLength,
			digest: assetDigest(secondBytes),
		}
		await writeFile(join(sourceRoot, descriptor.path), secondBytes)
		await writeFile(
			join(sourceRoot, `assets.json`),
			`${JSON.stringify(assetIndex(second))}\n`,
		)
		await git(root, `add`, `source`)
		await git(root, `commit`, `-m`, `Replace binary source`)
		const secondCommit = await git(root, `rev-parse`, `HEAD`)

		const immutable = await versionControl.readComparison({
			baseRef: initial,
			targetRef: secondCommit,
		})
		expect(immutable.base.snapshot.assets).toEqual([descriptor])
		expect(immutable.target.snapshot.assets).toEqual([second])
		expect(immutable.changes.map(({ paths }) => paths[0])).toEqual([
			`assets.json`,
			descriptor.path,
		])

		const workingBytes = new Uint8Array([1, 0, 255, 128, 3])
		const working = {
			...descriptor,
			byteLength: workingBytes.byteLength,
			digest: assetDigest(workingBytes),
		}
		await writeFile(join(sourceRoot, descriptor.path), workingBytes)
		await writeFile(
			join(sourceRoot, `assets.json`),
			`${JSON.stringify(assetIndex(working))}\n`,
		)
		const live = await versionControl.readComparison({ baseRef: `HEAD` })
		expect(live.target.snapshot.assets).toEqual([working])
		expect(live.changes.map(({ paths }) => paths[0])).toEqual([
			`assets.json`,
			descriptor.path,
		])
	})

	it(`rejects historical assets with mismatched digest or length`, async () => {
		const { descriptor, root, sourceRoot, versionControl } =
			await assetFixture()
		const initial = await git(root, `rev-parse`, `HEAD`)
		await writeFile(
			join(sourceRoot, `assets.json`),
			`${JSON.stringify(
				assetIndex({ ...descriptor, digest: `sha256:${`0`.repeat(64)}` }),
			)}\n`,
		)
		await git(root, `add`, `source/assets.json`)
		await git(root, `commit`, `-m`, `Invalid digest`)
		const badDigest = await git(root, `rev-parse`, `HEAD`)
		await expect(
			versionControl.readComparison({
				baseRef: initial,
				targetRef: badDigest,
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })

		await writeFile(
			join(sourceRoot, `assets.json`),
			`${JSON.stringify(
				assetIndex({
					...descriptor,
					byteLength: descriptor.byteLength + 1,
				}),
			)}\n`,
		)
		await git(root, `add`, `source/assets.json`)
		await git(root, `commit`, `-m`, `Invalid length`)
		const badLength = await git(root, `rev-parse`, `HEAD`)
		await expect(
			versionControl.readComparison({
				baseRef: initial,
				targetRef: badLength,
			}),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})

	it(`commits exact reviewed groups and preserves unrelated changes`, async () => {
		const { root, sourceRoot, versionControl } = await fixture()
		await writeFile(join(sourceRoot, `a.json`), `{"value":"selected"}\n`)
		await writeFile(join(sourceRoot, `b.json`), `{"value":"staged"}\n`)
		await git(root, `add`, `source/b.json`)
		await writeFile(join(sourceRoot, `c.json`), `{"value":"untracked"}\n`)
		const reviewed = await versionControl.readComparison({ baseRef: `HEAD` })

		const result = await versionControl.commitUnits({
			expectedComparisonIdentity: reviewed.identity,
			message: `Select a`,
			paths: [`a.json`],
		})

		expect(await git(root, `show`, `HEAD:source/a.json`)).toContain(`selected`)
		expect(await git(root, `diff`, `--cached`, `--name-only`)).toBe(
			`source/b.json`,
		)
		expect(await git(root, `status`, `--short`, `source/c.json`)).toBe(
			`?? source/c.json`,
		)
		expect(result.comparison.changes.map(({ paths }) => paths[0])).toEqual([
			`b.json`,
			`c.json`,
		])

		await expect(
			versionControl.commitUnits({
				expectedComparisonIdentity: reviewed.identity,
				message: `Stale`,
				paths: [`b.json`],
			}),
		).rejects.toMatchObject({ code: `source.commit_conflict` })
	})

	it(`rejects unsafe refs and incomplete adapter groups`, async () => {
		const { sourceRoot, versionControl } = await fixture()
		await expect(
			versionControl.readComparison({ baseRef: `--help` }),
		).rejects.toMatchObject({ code: `source.invalid_ref` })
		await writeFile(join(sourceRoot, `a.json`), `{"value":"changed"}\n`)
		const incomplete = createSourceVersionControl(
			sourceRoot,
			async () => ({
				revision: revision(`working`),
				units: [
					{
						path: `a.json`,
						revision: revision(`changed`),
						value: { value: `changed` },
					},
				],
			}),
			{ ...adapter, groupChanges: () => [] },
		)
		await expect(
			incomplete.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.repository_state` })
	})

	it(`reports an unreadable working snapshot as repository state`, async () => {
		const { sourceRoot } = await fixture()
		const versionControl = createSourceVersionControl(
			sourceRoot,
			async () => {
				throw new Error(`Source asset fonts/missing.otf does not exist.`)
			},
			adapter,
		)
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({
			code: `source.repository_state`,
			message: expect.stringContaining(`fonts/missing.otf`),
		})
	})

	it(`bounds historical snapshot unit counts and bytes before parsing`, async () => {
		const root = await mkdtemp(join(tmpdir(), `source-version-control-limit-`))
		temporaryRoots.push(root)
		const hash = `a`.repeat(40)
		const runtime: SourceVersionControlRuntime = {
			async run(_command, args) {
				const text = (value: string) => new TextEncoder().encode(value)
				if (args[0] === `rev-parse` && args[1] === `--show-toplevel`)
					return { exitCode: 0, stderr: ``, stdout: text(`${root}\n`) }
				if (args[0] === `rev-parse`)
					return { exitCode: 0, stderr: ``, stdout: text(`${hash}\n`) }
				if (args[0] === `ls-tree`)
					return { exitCode: 0, stderr: ``, stdout: text(`large.bin\0`) }
				if (args[0] === `cat-file`)
					return {
						exitCode: 0,
						stderr: ``,
						stdout: text(`${32 * 1024 * 1024 + 1}\n`),
					}
				return {
					exitCode: 0,
					stderr: ``,
					stdout: new Uint8Array(32 * 1024 * 1024 + 1),
				}
			},
		}
		const versionControl = createSourceVersionControl(
			root,
			async () => ({ revision: `working`, units: [] }),
			{
				...adapter,
				assets: {
					descriptors: () => [],
					isPath: (path) => path.endsWith(`.bin`),
				},
				includesPath: () => false,
			},
			runtime,
		)
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toBeInstanceOf(SourceVersionControlError)
		await expect(
			versionControl.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.snapshot_too_large` })

		const tooMany = createSourceVersionControl(
			root,
			async () => ({ revision: `working`, units: [] }),
			adapter,
			{
				async run(_command, args) {
					const text = (value: string) => new TextEncoder().encode(value)
					if (args[0] === `rev-parse` && args[1] === `--show-toplevel`)
						return { exitCode: 0, stderr: ``, stdout: text(`${root}\n`) }
					if (args[0] === `rev-parse`)
						return { exitCode: 0, stderr: ``, stdout: text(`${hash}\n`) }
					return {
						exitCode: 0,
						stderr: ``,
						stdout: text(
							Array.from(
								{ length: 2_001 },
								(_, index) => `unit-${index}.json\0`,
							).join(``),
						),
					}
				},
			},
		)
		await expect(
			tooMany.readComparison({ baseRef: `HEAD` }),
		).rejects.toMatchObject({ code: `source.snapshot_too_large` })
	})
})
