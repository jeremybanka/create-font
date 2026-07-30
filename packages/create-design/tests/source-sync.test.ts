import {
	sourceSyncStateFromSnapshot,
	type JsonValue,
} from "@create-art/source-rpc"
import {
	formatSourceUnit,
	sourceUnitKindForPath,
	splitDesignDocument,
} from "@create-design/source"
import { describe, expect, test } from "vitest"

import { createInitialDocument } from "../src/document.ts"
import { designSourceTransaction } from "../src/source-sync.ts"

function initialState() {
	const split = splitDesignDocument(createInitialDocument())
	if (!split.ok) throw new Error(`Could not split fixture.`)
	return sourceSyncStateFromSnapshot({
		revision: `project`,
		units: Object.entries(split.value).map(([path, value]) => {
			const kind = sourceUnitKindForPath(path)
			if (kind === null) throw new Error(`Unknown fixture unit.`)
			const formatted = formatSourceUnit(kind, value)
			if (!formatted.ok) throw new Error(`Could not format fixture.`)
			return {
				path,
				revision: `revision:${path}`,
				value: value as JsonValue,
			}
		}),
	})
}

describe(`create-design source synchronization`, () => {
	test(`does not rewrite semantically unchanged canonical units`, () => {
		expect(
			designSourceTransaction(initialState(), createInitialDocument()),
		).toEqual({ removals: [], writes: [] })
	})

	test(`writes only the changed metadata unit`, () => {
		const document = createInitialDocument()
		const transaction = designSourceTransaction(initialState(), {
			...document,
			title: `Renamed`,
		})
		expect(transaction.removals).toEqual([])
		expect(transaction.writes.map(({ path }) => path)).toEqual([
			`document.json`,
		])
	})

	test(`removes an object and updates only its inventories`, () => {
		const document = createInitialDocument()
		const transaction = designSourceTransaction(initialState(), {
			...document,
			objects: document.objects.slice(1),
		})
		expect(transaction.removals).toHaveLength(1)
		expect(transaction.removals[0]?.path).toContain(`scene/objects/`)
		expect(transaction.writes.map(({ path }) => path)).toEqual([
			`scene/layers/artwork.json`,
			`scene/objects/index.json`,
		])
	})
})
