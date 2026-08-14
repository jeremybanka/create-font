import type { ActionSnapshot, ConfirmedAction } from "@create-art/realtime"
import { CollaborationActionError } from "@create-art/realtime/server"
import {
	assembleEditorFontSource,
	splitEditorFontSource,
} from "@create-font/source"
import {
	createFontEditorState,
	type EditorFontSource,
	type FontDocumentCommand,
} from "@create-font/states"
import type {
	CreateFontSourceService,
	JsonValue,
	SourceProjectSnapshot,
} from "@create-font/server"

function editorSourceFromSnapshot(
	snapshot: SourceProjectSnapshot,
): EditorFontSource {
	const assembled = assembleEditorFontSource(
		Object.fromEntries(snapshot.units.map((unit) => [unit.path, unit.value])),
	)
	if (!assembled.ok) throw new Error(assembled.errors[0].message)
	return assembled.value
}

function sourceUnits(source: EditorFontSource): ReadonlyMap<string, JsonValue> {
	const split = splitEditorFontSource(source)
	if (!split.ok) throw new Error(split.errors[0].message)
	return new Map(
		Object.entries(split.value).map(([path, value]) => [
			path,
			value as JsonValue,
		]),
	)
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function externalReconciliation(
	current: EditorFontSource,
	next: EditorFontSource,
): Extract<FontDocumentCommand, { type: `reconcileExternalSource` }> {
	const currentGlyphIds = current.glyphs.map((glyph) => glyph.id)
	const nextGlyphIds = next.glyphs.map((glyph) => glyph.id)
	const allGlyphs = !sameValue(
		{
			axes: current.axes,
			cmap: current.cmap,
			defaultMasterId: current.defaultMasterId,
			glyphIds: currentGlyphIds,
			instances: current.instances,
			masters: current.masters,
		},
		{
			axes: next.axes,
			cmap: next.cmap,
			defaultMasterId: next.defaultMasterId,
			glyphIds: nextGlyphIds,
			instances: next.instances,
			masters: next.masters,
		},
	)
	const currentGlyphs = new Map(
		current.glyphs.map((glyph) => [glyph.id, glyph]),
	)
	const glyphIds = allGlyphs
		? nextGlyphIds
		: next.glyphs.flatMap((glyph) => {
				const previous = currentGlyphs.get(glyph.id)
				return previous !== undefined && sameValue(previous, glyph)
					? []
					: [glyph.id]
			})
	return {
		input: {
			allGlyphs,
			glyphIds,
			kerning:
				allGlyphs || !sameValue(current.kerning ?? [], next.kerning ?? []),
			source: next,
		},
		type: `reconcileExternalSource`,
	}
}

export function isFontDocumentCommand(
	value: unknown,
): value is FontDocumentCommand {
	if (typeof value !== `object` || value === null || Array.isArray(value)) {
		return false
	}
	const type = Reflect.get(value, `type`)
	if (type === `undoKerning` || type === `redoKerning`) return true
	if (type === `undoGlyph` || type === `redoGlyph`) {
		const glyphId = Reflect.get(value, `glyphId`)
		return typeof glyphId === `string` && glyphId.length <= 512
	}
	const input = Reflect.get(value, `input`)
	if (type === `addGlyphs`) {
		return (
			Array.isArray(input) &&
			input.length > 0 &&
			input.length <= 512 &&
			input.every(
				(name) =>
					typeof name === `string` && name.length > 0 && name.length <= 512,
			)
		)
	}
	if (typeof input !== `object` || input === null || Array.isArray(input)) {
		return false
	}
	if (type === `setCoreSource`) {
		const field = Reflect.get(input, `field`)
		const source = Reflect.get(input, `value`)
		return (
			(field === `metadata` ||
				field === `names` ||
				field === `metrics` ||
				field === `style`) &&
			typeof source === `object` &&
			source !== null &&
			!Array.isArray(source)
		)
	}
	return (
		type === `setGlyphRules` ||
		type === `movePoints` ||
		type === `setCornerProfiles` ||
		type === `setHorizontalMetrics` ||
		type === `moveHandle` ||
		type === `transformControls` ||
		type === `slideSoftNode` ||
		type === `setNodeMode` ||
		type === `toggleNodeModes` ||
		type === `authorPenEndpoint` ||
		type === `insertPoint` ||
		type === `addSegmentHandles` ||
		type === `splitSegment` ||
		type === `cutSegment` ||
		type === `joinOpenContours` ||
		type === `reverseContour` ||
		type === `invertContour` ||
		type === `makeNodeFirst` ||
		type === `createContour` ||
		type === `setContourClosed` ||
		type === `reorderContour` ||
		type === `closeContour` ||
		type === `createCompleteContour` ||
		type === `pasteContours` ||
		type === `deleteSelection` ||
		type === `setKerningPair`
	)
}

export async function createFontCollaborationAuthority(
	source: CreateFontSourceService,
) {
	let sourceSnapshot = await source.readSnapshot()
	const base = editorSourceFromSnapshot(sourceSnapshot)
	const state = createFontEditorState({
		key: `create-font/server-authority`,
		isProduction: true,
	})
	state.actions.load(base)
	let epoch = 0
	let actions: ConfirmedAction<FontDocumentCommand>[] = []
	const ownOperationIds = new Set<string>()
	const resetListeners = new Set<
		(snapshot: ActionSnapshot<EditorFontSource, FontDocumentCommand>) => void
	>()

	const snapshot = (): ActionSnapshot<
		EditorFontSource,
		FontDocumentCommand
	> => ({
		actions: Object.freeze([...actions]),
		base,
		epoch,
	})

	const reconcileFromSnapshot = (
		nextSnapshot: SourceProjectSnapshot,
		operationId: string,
	): void => {
		const current = state.read.editorSource()
		if (current === null) throw new Error(`The shared font is not loaded.`)
		const nextSource = editorSourceFromSnapshot(nextSnapshot)
		const command = externalReconciliation(current, nextSource)
		sourceSnapshot = nextSnapshot
		state.applyDocumentCommand(command)
		epoch += 1
		actions.push({
			authorDeviceId: `source`,
			command,
			epoch,
			operationId,
		})
		const next = snapshot()
		for (const listener of resetListeners) listener(next)
	}

	let externalRefresh = Promise.resolve()
	let commitQueue = Promise.resolve()
	const unsubscribe = source.subscribe?.((event) => {
		if (ownOperationIds.delete(event.operationId)) return
		externalRefresh = externalRefresh
			.then(async () =>
				reconcileFromSnapshot(await source.readSnapshot(), event.operationId),
			)
			.catch((error: unknown) => {
				console.error(`Unable to reconcile an external source change.`, error)
			})
	})

	return {
		dispose(): void {
			unsubscribe?.()
		},
		onReset(
			listener: (
				snapshot: ActionSnapshot<EditorFontSource, FontDocumentCommand>,
			) => void,
		): () => void {
			resetListeners.add(listener)
			return () => resetListeners.delete(listener)
		},
		snapshot,
		async apply(
			command: FontDocumentCommand,
			context: Readonly<{
				authorDeviceId: string
				baseEpoch: number
				operationId: string
			}>,
		): Promise<boolean> {
			let releaseCommit!: () => void
			const precedingCommit = commitQueue
			commitQueue = new Promise<void>((resolve) => {
				releaseCommit = resolve
			})
			await precedingCommit
			try {
				await externalRefresh
				if (
					actions.some((action) => action.operationId === context.operationId)
				) {
					return false
				}
				if (context.baseEpoch !== epoch) {
					throw new CollaborationActionError(
						`stale`,
						`The workspace advanced before this edit could be persisted.`,
					)
				}
				const staging = createFontEditorState({
					key: `create-font/server-staging/${context.operationId}`,
					isProduction: true,
				})
				staging.actions.load(base)
				for (const action of actions) {
					staging.applyDocumentCommand(action.command)
				}
				staging.applyDocumentCommand(command)
				const nextSource = staging.read.editorSource()
				if (nextSource === null)
					throw new Error(`The command unloaded the font.`)

				const beforeUnits = sourceUnits(state.read.editorSource() ?? base)
				const afterUnits = sourceUnits(nextSource)
				const currentUnits = new Map(
					sourceSnapshot.units.map((unit) => [unit.path, unit]),
				)
				const writes = [...afterUnits].flatMap(([path, value]) => {
					const previous = beforeUnits.get(path)
					if (previous !== undefined && sameValue(previous, value)) return []
					return [
						{
							expectedRevision: currentUnits.get(path)?.revision ?? null,
							path,
							value,
						},
					]
				})
				const removals = [...beforeUnits.keys()].flatMap((path) => {
					if (afterUnits.has(path)) return []
					const revision = currentUnits.get(path)?.revision
					return revision === undefined
						? []
						: [{ expectedRevision: revision, path }]
				})
				if (writes.length === 0 && removals.length === 0) {
					throw new Error(`The command did not change the document.`)
				}
				ownOperationIds.add(context.operationId)
				if (ownOperationIds.size > 1_024) {
					const oldestOperationId = ownOperationIds.values().next().value
					if (oldestOperationId !== undefined) {
						ownOperationIds.delete(oldestOperationId)
					}
				}
				try {
					await source.writeUnits({
						idempotencyKey: context.operationId,
						...(removals.length === 0 ? {} : { removals }),
						writes,
					})
					sourceSnapshot = await source.readSnapshot()
				} catch (error) {
					ownOperationIds.delete(context.operationId)
					throw error
				}
				state.applyDocumentCommand(command)
				epoch += 1
				actions.push({
					authorDeviceId: context.authorDeviceId,
					command,
					epoch,
					operationId: context.operationId,
				})
				return true
			} finally {
				releaseCommit()
			}
		},
	}
}
