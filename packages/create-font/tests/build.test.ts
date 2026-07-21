import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { buildProject } from "../src/build.ts"

const temporaryRoots: string[] = []

async function copyWorkbenchSans(): Promise<string> {
	const workspaceRoot = await mkdtemp(resolve(tmpdir(), `create-font-build-`))
	temporaryRoots.push(workspaceRoot)
	const projectRoot = resolve(workspaceRoot, `fonts`, `workbench-sans`)
	await cp(
		resolve(import.meta.dir, `../../../fonts/workbench-sans`),
		projectRoot,
		{
			recursive: true,
		},
	)
	return projectRoot
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true })),
	)
})

function tableTags(bytes: Uint8Array): readonly string[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return Array.from({ length: view.getUint16(4) }, (_value, index) => {
		const offset = 12 + index * 16
		return String.fromCharCode(...bytes.slice(offset, offset + 4))
	})
}

function checksum(bytes: Uint8Array): number {
	let sum = 0
	for (let offset = 0; offset < bytes.length; offset += 4) {
		const value =
			((bytes[offset] ?? 0) << 24) |
			((bytes[offset + 1] ?? 0) << 16) |
			((bytes[offset + 2] ?? 0) << 8) |
			(bytes[offset + 3] ?? 0)
		sum = (sum + (value >>> 0)) >>> 0
	}
	return sum
}

describe(`buildProject`, () => {
	it(`compiles feature files into a conventional GSUB table`, async () => {
		const root = await copyWorkbenchSans()
		await mkdir(resolve(root, `features`))
		await writeFile(
			resolve(root, `features`, `layout.fea`),
			`feature liga { sub A O by O; } liga;\n`,
		)
		const result = await buildProject(root)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		const bytes = new Uint8Array(await readFile(result.outputs[0]!))
		expect(tableTags(bytes)).toContain(`GSUB`)
		expect(checksum(bytes)).toBe(0xb1b0_afba)
	})
	it(`builds Workbench Sans deterministically through the complete pipeline`, async () => {
		const root = await copyWorkbenchSans()
		const first = await buildProject(root)
		expect(first.ok).toBe(true)
		if (!first.ok) return
		expect(first.outputs).toEqual([
			resolve(
				root,
				`..`,
				`..`,
				`artifacts`,
				`workbench-sans`,
				`WorkbenchSans-Text.ttf`,
			),
		])
		const firstBytes = new Uint8Array(await readFile(first.outputs[0]!))
		const second = await buildProject(root)
		expect(second.ok).toBe(true)
		if (!second.ok) return
		const secondBytes = new Uint8Array(await readFile(second.outputs[0]!))

		expect(firstBytes).toEqual(secondBytes)
		expect(checksum(firstBytes)).toBe(0xb1b0_afba)
		expect(tableTags(firstBytes)).toEqual([
			`OS/2`,
			`STAT`,
			`cmap`,
			`fvar`,
			`glyf`,
			`gvar`,
			`head`,
			`hhea`,
			`hmtx`,
			`loca`,
			`maxp`,
			`name`,
			`post`,
		])
	})

	it(`preserves the last successful artifact when source validation fails`, async () => {
		const root = await copyWorkbenchSans()
		const built = await buildProject(root)
		expect(built.ok).toBe(true)
		if (!built.ok) return
		const before = await readFile(built.outputs[0]!)
		const namesPath = resolve(root, `names.json`)
		const names = await readFile(namesPath, `utf8`)
		await writeFile(
			namesPath,
			names.replace(`"family": "Workbench Sans"`, `"family": ""`),
		)

		const failed = await buildProject(root)
		expect(failed.ok).toBe(false)
		if (failed.ok) return
		expect(failed.errors).toContainEqual(
			expect.objectContaining({
				code: `name.empty`,
				path: `$.names.family`,
				severity: `error`,
				table: `name`,
			}),
		)
		expect(await readFile(built.outputs[0]!)).toEqual(before)
	})

	it(`reports a missing project root without throwing`, async () => {
		const result = await buildProject(
			resolve(tmpdir(), `missing-create-font-project`),
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toEqual([
			expect.objectContaining({
				code: `workspace.not_directory`,
				severity: `error`,
			}),
		])
	})
})
