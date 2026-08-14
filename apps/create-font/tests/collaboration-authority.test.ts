import { createHash } from "node:crypto"

import {
	assembleEditorFontSource,
	splitEditorFontSource,
} from "@create-font/source"
import type {
	CreateFontSourceService,
	JsonValue,
	SourceChangedEvent,
	SourceProjectSnapshot,
	WriteSourceUnitsInput,
} from "@create-font/server"
import type {
	EditorFontSource,
	GlyphId,
	MasterId,
	PointId,
} from "@create-font/states"
import { createFontEditorState } from "@create-font/states"
import { describe, expect, it } from "vitest"

import { makeGeometricOEditorFont } from "../../../packages/create-font/states/tests/fixtures/geometric-o.ts"
import {
	createFontCollaborationAuthority,
	isFontDocumentCommand,
} from "../src/collaboration-authority.ts"

function revision(value: JsonValue): string {
	return `sha256:${createHash(`sha256`).update(JSON.stringify(value)).digest(`hex`)}`
}

function memorySource(initial: EditorFontSource) {
	const split = splitEditorFontSource(initial)
	if (!split.ok) throw new Error(split.errors[0].message)
	const values = new Map(
		Object.entries(split.value).map(([path, value]) => [
			path,
			value as JsonValue,
		]),
	)
	const listeners = new Set<(event: SourceChangedEvent) => void>()
	let failNextWrite = false
	let writes = 0
	const snapshot = (): SourceProjectSnapshot => {
		const units = [...values].map(([path, value]) => ({
			path,
			revision: revision(value),
			value,
		}))
		return {
			revision: revision(
				units.map(({ path, revision: unitRevision }) => [path, unitRevision]),
			),
			units,
		}
	}
	const service: CreateFontSourceService = {
		readManifest: async () => {
			const current = snapshot()
			return {
				revision: current.revision,
				units: current.units.map(({ path, revision: unitRevision }) => ({
					path,
					revision: unitRevision,
				})),
			}
		},
		readSnapshot: async () => snapshot(),
		async readUnit(path) {
			const value = values.get(path)
			if (value === undefined) throw new Error(`Unknown unit ${path}.`)
			return { path, revision: revision(value), value }
		},
		async writeUnit(input) {
			const result = await service.writeUnits({
				idempotencyKey: input.idempotencyKey,
				writes: [input],
			})
			return result.units[0]!
		},
		async writeUnits(input: WriteSourceUnitsInput) {
			if (failNextWrite) {
				failNextWrite = false
				throw new Error(`Simulated persistence failure.`)
			}
			writes += 1
			const before = snapshot()
			for (const write of input.writes) {
				const actual = values.get(write.path)
				expect(write.expectedRevision).toBe(
					actual === undefined ? null : revision(actual),
				)
				values.set(write.path, write.value)
			}
			for (const removal of input.removals ?? []) values.delete(removal.path)
			const after = snapshot()
			const event: SourceChangedEvent = {
				type: `source.changed`,
				operationId: input.idempotencyKey,
				previousRevision: before.revision,
				removedPaths: input.removals?.map(({ path }) => path) ?? [],
				revision: after.revision,
				units: after.units.filter((unit) =>
					input.writes.some((write) => write.path === unit.path),
				),
			}
			for (const listener of listeners) listener(event)
			return {
				previousRevision: before.revision,
				removedPaths: event.removedPaths,
				revision: after.revision,
				units: event.units,
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
	return {
		failNextWrite(): void {
			failNextWrite = true
		},
		service,
		snapshot,
		get writes() {
			return writes
		},
	}
}

describe(`font collaboration authority`, () => {
	it(`rejects unregistered or structurally invalid command payloads`, () => {
		expect(isFontDocumentCommand({ type: `movePoints` })).toBe(false)
		expect(isFontDocumentCommand({ type: `runCommand`, input: {} })).toBe(false)
		expect(
			isFontDocumentCommand({ type: `reconcileExternalSource`, input: {} }),
		).toBe(false)
		expect(
			isFontDocumentCommand({
				type: `addGlyphs`,
				input: Array.from({ length: 513 }, () => `A`),
			}),
		).toBe(false)
		expect(
			isFontDocumentCommand({ type: `undoGlyph`, glyphId: `glyph:A` }),
		).toBe(true)
	})

	it(`persists registered edits before recording them and reconstructs shared undo`, async () => {
		const initial = makeGeometricOEditorFont()
		const remote = memorySource(initial)
		const authority = await createFontCollaborationAuthority(remote.service)
		const glyph = initial.glyphs.find((candidate) => candidate.name === `O`)!
		const layer = glyph.layers[0]!
		const point = layer.contours[0]!.points[0]!
		const move = {
			type: `movePoints`,
			input: {
				glyphId: glyph.id as GlyphId,
				masterId: layer.masterId as MasterId,
				points: [{ pointId: point.id as PointId, x: point.x + 17, y: point.y }],
			},
		} as const
		await authority.apply(move, {
			authorDeviceId: `guest`,
			baseEpoch: 0,
			operationId: `move-1`,
		})
		expect(remote.writes).toBe(1)
		expect(authority.snapshot()).toMatchObject({ epoch: 1 })
		expect(authority.snapshot().actions).toHaveLength(1)
		expect(
			await authority.apply(move, {
				authorDeviceId: `guest`,
				baseEpoch: 0,
				operationId: `move-1`,
			}),
		).toBe(false)
		await expect(
			authority.apply(
				{
					type: `movePoints`,
					input: {
						glyphId: glyph.id as GlyphId,
						masterId: layer.masterId as MasterId,
						points: [
							{ pointId: point.id as PointId, x: point.x + 17, y: point.y },
						],
					},
				},
				{
					authorDeviceId: `guest`,
					baseEpoch: 0,
					operationId: `stale-move`,
				},
			),
		).rejects.toMatchObject({ code: `stale` })
		expect(remote.writes).toBe(1)

		await authority.apply(
			{ type: `undoGlyph`, glyphId: glyph.id as GlyphId },
			{ authorDeviceId: `host`, baseEpoch: 1, operationId: `undo-1` },
		)
		expect(authority.snapshot()).toMatchObject({ epoch: 2 })
		const persisted = assembleEditorFontSource(
			Object.fromEntries(
				remote.snapshot().units.map((unit) => [unit.path, unit.value]),
			),
		)
		expect(persisted.ok && persisted.value).toEqual(initial)
		authority.dispose()
	})

	it(`does not confirm failed persistence and resets after external changes`, async () => {
		const initial = makeGeometricOEditorFont()
		const remote = memorySource(initial)
		const authority = await createFontCollaborationAuthority(remote.service)
		const glyph = initial.glyphs.find((candidate) => candidate.name === `O`)!
		const layer = glyph.layers[0]!
		const point = layer.contours[0]!.points[0]!
		const move = {
			type: `movePoints`,
			input: {
				glyphId: glyph.id as GlyphId,
				masterId: layer.masterId as MasterId,
				points: [{ pointId: point.id as PointId, x: point.x + 2, y: point.y }],
			},
		} as const
		remote.failNextWrite()
		await expect(
			authority.apply(move, {
				authorDeviceId: `guest`,
				baseEpoch: 0,
				operationId: `failed-move`,
			}),
		).rejects.toThrow(`persistence failure`)
		expect(authority.snapshot()).toMatchObject({ actions: [], epoch: 0 })
		await authority.apply(move, {
			authorDeviceId: `guest`,
			baseEpoch: 0,
			operationId: `move-1`,
		})

		const names = remote
			.snapshot()
			.units.find((unit) => unit.path === `names.json`)!
		const reset = new Promise<void>((resolve) => {
			authority.onReset(() => resolve())
		})
		await remote.service.writeUnits({
			idempotencyKey: `external-names-edit`,
			writes: [
				{
					expectedRevision: names.revision,
					path: names.path,
					value: { ...(names.value as object), family: `Externally edited` },
				},
			],
		})
		await reset
		expect(authority.snapshot()).toMatchObject({ epoch: 2 })
		expect(authority.snapshot().actions).toHaveLength(2)
		const recovered = createFontEditorState({
			key: `create-font/test-external-recovery`,
			isProduction: true,
		})
		recovered.actions.load(authority.snapshot().base)
		for (const action of authority.snapshot().actions) {
			recovered.applyDocumentCommand(action.command)
		}
		expect(recovered.read.editorSource()?.names.family).toBe(
			`Externally edited`,
		)

		await authority.apply(
			{ type: `undoGlyph`, glyphId: glyph.id as GlyphId },
			{
				authorDeviceId: `host`,
				baseEpoch: 2,
				operationId: `undo-after-external`,
			},
		)
		const persisted = assembleEditorFontSource(
			Object.fromEntries(
				remote.snapshot().units.map((unit) => [unit.path, unit.value]),
			),
		)
		expect(persisted.ok && persisted.value.names.family).toBe(
			`Externally edited`,
		)
		expect(
			persisted.ok &&
				persisted.value.glyphs.find((candidate) => candidate.id === glyph.id)
					?.layers[0]?.contours[0]?.points[0]?.x,
		).toBe(point.x)
		authority.dispose()
	})

	it(`invalidates only the glyph history changed outside the session`, async () => {
		const initial = makeGeometricOEditorFont()
		const remote = memorySource(initial)
		const authority = await createFontCollaborationAuthority(remote.service)
		const [notdef, glyph] = initial.glyphs
		if (notdef === undefined || glyph === undefined) {
			throw new Error(`The fixture requires two glyphs.`)
		}
		const notdefLayer = notdef.layers[0]!
		const glyphLayer = glyph.layers[0]!
		const notdefPoint = notdefLayer.contours[0]!.points[0]!
		const glyphPoint = glyphLayer.contours[0]!.points[0]!
		await authority.apply(
			{
				type: `movePoints`,
				input: {
					glyphId: glyph.id,
					masterId: glyphLayer.masterId,
					points: [
						{ pointId: glyphPoint.id, x: glyphPoint.x + 3, y: glyphPoint.y },
					],
				},
			},
			{ authorDeviceId: `one`, baseEpoch: 0, operationId: `move-o` },
		)
		await authority.apply(
			{
				type: `movePoints`,
				input: {
					glyphId: notdef.id,
					masterId: notdefLayer.masterId,
					points: [
						{
							pointId: notdefPoint.id,
							x: notdefPoint.x + 5,
							y: notdefPoint.y,
						},
					],
				},
			},
			{ authorDeviceId: `two`, baseEpoch: 1, operationId: `move-notdef` },
		)

		const beforeExternal = remote.snapshot()
		const assembled = assembleEditorFontSource(
			Object.fromEntries(
				beforeExternal.units.map((unit) => [unit.path, unit.value]),
			),
		)
		if (!assembled.ok) throw new Error(assembled.errors[0].message)
		const externalX = glyphPoint.x + 40
		const external: EditorFontSource = {
			...assembled.value,
			glyphs: assembled.value.glyphs.map((candidate) =>
				candidate.id !== glyph.id
					? candidate
					: {
							...candidate,
							layers: candidate.layers.map((layer, layerIndex) =>
								layerIndex !== 0
									? layer
									: {
											...layer,
											contours: layer.contours.map((contour, contourIndex) =>
												contourIndex !== 0
													? contour
													: {
															...contour,
															points: contour.points.map((point, pointIndex) =>
																pointIndex === 0
																	? { ...point, x: externalX }
																	: point,
															),
														},
											),
										},
							),
						},
			),
		}
		const externalUnits = splitEditorFontSource(external)
		if (!externalUnits.ok) throw new Error(externalUnits.errors[0].message)
		const previousUnits = new Map(
			beforeExternal.units.map((unit) => [unit.path, unit]),
		)
		const changed = Object.entries(externalUnits.value).filter(
			([path, value]) =>
				JSON.stringify(previousUnits.get(path)?.value) !==
				JSON.stringify(value),
		)
		expect(changed).toHaveLength(1)
		const reset = new Promise<void>((resolve) =>
			authority.onReset(() => resolve()),
		)
		await remote.service.writeUnits({
			idempotencyKey: `external-o`,
			writes: changed.map(([path, value]) => ({
				expectedRevision: previousUnits.get(path)?.revision ?? null,
				path,
				value: value as JsonValue,
			})),
		})
		await reset

		await expect(
			authority.apply(
				{ type: `undoGlyph`, glyphId: glyph.id },
				{ authorDeviceId: `one`, baseEpoch: 3, operationId: `undo-o` },
			),
		).rejects.toThrow(`did not change`)
		await authority.apply(
			{ type: `undoGlyph`, glyphId: notdef.id },
			{ authorDeviceId: `two`, baseEpoch: 3, operationId: `undo-notdef` },
		)
		const persisted = assembleEditorFontSource(
			Object.fromEntries(
				remote.snapshot().units.map((unit) => [unit.path, unit.value]),
			),
		)
		expect(
			persisted.ok &&
				persisted.value.glyphs.find((candidate) => candidate.id === glyph.id)
					?.layers[0]?.contours[0]?.points[0]?.x,
		).toBe(externalX)
		expect(
			persisted.ok &&
				persisted.value.glyphs.find((candidate) => candidate.id === notdef.id)
					?.layers[0]?.contours[0]?.points[0]?.x,
		).toBe(notdefPoint.x)
		authority.dispose()
	})
})
