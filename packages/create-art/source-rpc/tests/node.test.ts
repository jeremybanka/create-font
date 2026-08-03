import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, test } from "vitest"

import type { JsonValue, SourceChangedEvent } from "../src/index.ts"
import {
	createFileSystemSourceService,
	type JsonSourceWorkspaceCodec,
} from "../src/node.ts"

const codec: JsonSourceWorkspaceCodec<`json`> = {
	assemble(files) {
		return files[`project.json`] === undefined
			? {
					ok: false,
					errors: [
						{
							code: `project.required`,
							message: `project.json is required.`,
							path: `$`,
						},
					],
				}
			: { ok: true, value: files }
	},
	format(_kind, value) {
		return { ok: true, value: `${JSON.stringify(value)}\n` }
	},
	kindForPath(path) {
		return path.endsWith(`.json`) ? `json` : null
	},
	parse(_kind, text, path) {
		try {
			return { ok: true, value: JSON.parse(text) as JsonValue }
		} catch {
			return {
				ok: false,
				errors: [
					{
						code: `json.syntax`,
						message: `Invalid JSON.`,
						path: `$`,
						unitPath: path,
					},
				],
			}
		}
	},
}

async function workspace() {
	const root = await mkdtemp(join(tmpdir(), `source-rpc-`))
	await writeFile(join(root, `project.json`), `{"name":"test"}\n`)
	return { root, service: await createFileSystemSourceService(root, codec) }
}

describe(`filesystem source service`, () => {
	test(`preserves the JSON-only manifest shape and revision algorithm`, async () => {
		const { service } = await workspace()
		const snapshot = await service.readSnapshot()
		const unit = snapshot.units[0]
		if (unit === undefined) throw new Error(`Missing project unit.`)
		expect(snapshot).not.toHaveProperty(`assets`)
		expect(snapshot.revision).toBe(
			`sha256:${createHash(`sha256`)
				.update(`${unit.path}\0${unit.revision}\n`)
				.digest(`hex`)}`,
		)
	})

	test(`creates, replaces, and removes units as one conditional transaction`, async () => {
		const { service } = await workspace()
		const events: SourceChangedEvent[] = []
		service.subscribe?.((event) => events.push(event))
		const before = await service.readSnapshot()
		const project = before.units[0]
		if (project === undefined) throw new Error(`Missing project.`)
		const created = await service.writeUnits({
			idempotencyKey: `create`,
			writes: [
				{
					expectedRevision: project.revision,
					path: project.path,
					value: { name: `renamed` },
				},
				{ expectedRevision: null, path: `unit.json`, value: { value: 1 } },
			],
		})
		expect(created.units).toHaveLength(2)
		const unit = created.units.find(({ path }) => path === `unit.json`)
		if (unit === undefined) throw new Error(`Missing created unit.`)
		const removed = await service.writeUnits({
			idempotencyKey: `remove`,
			removals: [{ expectedRevision: unit.revision, path: unit.path }],
			writes: [],
		})
		expect(removed.removedPaths).toEqual([`unit.json`])
		expect(events.at(-1)?.removedPaths).toEqual([`unit.json`])
		await expect(service.readUnit(`unit.json`)).rejects.toMatchObject({
			name: `SourceUnitNotFoundError`,
		})
	})

	test(`validates the complete candidate and replays idempotent results`, async () => {
		const { service } = await workspace()
		const before = await service.readSnapshot()
		const project = before.units[0]
		if (project === undefined) throw new Error(`Missing project.`)
		await expect(
			service.writeUnits({
				idempotencyKey: `invalid`,
				removals: [{ expectedRevision: project.revision, path: project.path }],
				writes: [],
			}),
		).rejects.toMatchObject({ name: `SourceValidationError` })
		expect((await service.readSnapshot()).revision).toBe(before.revision)
		const input = {
			idempotencyKey: `retry`,
			writes: [
				{
					expectedRevision: project.revision,
					path: project.path,
					value: { name: `retried` },
				},
			],
		} as const
		const first = await service.writeUnits(input)
		expect(await service.writeUnits(input)).toEqual(first)
	})

	test(`rolls an interrupted journal back before serving the workspace`, async () => {
		const { root } = await workspace()
		const transaction = join(root, `.create-art`, `transactions`, `interrupted`)
		const backup = join(transaction, `backup`, `project.json`)
		await mkdir(dirname(backup), { recursive: true })
		await rename(join(root, `project.json`), backup)
		await writeFile(join(root, `project.json`), `{"name":"partial"}\n`)
		await writeFile(
			join(transaction, `transaction.json`),
			`${JSON.stringify({
				entries: [{ existed: true, path: `project.json` }],
			})}\n`,
		)
		await createFileSystemSourceService(root, codec)
		expect(await readFile(join(root, `project.json`), `utf8`)).toBe(
			`{"name":"test"}\n`,
		)
	})
})
