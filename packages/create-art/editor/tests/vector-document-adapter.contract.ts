import { describe, expect, it } from "vitest"

import type {
	VectorDocumentAdapter,
	VectorEditIntent,
	VectorObject,
	VectorSelectionTarget,
} from "../src/vector-editing.ts"

export interface VectorAdapterContractHarness<Document, Selection> {
	readonly adapter: VectorDocumentAdapter<Document, Selection>
	readonly document: Document
	readonly selection: Selection
	readonly selectedObjectId: string
	readonly update: (
		object: VectorObject,
		snapshotSelection: readonly VectorSelectionTarget[],
	) => VectorEditIntent
	readonly remove: (
		object: VectorObject,
		snapshotSelection: readonly VectorSelectionTarget[],
	) => VectorEditIntent
	readonly invalid: VectorEditIntent
	readonly assertUpdated: (document: Document) => void
	readonly assertDeleted: (document: Document) => void
}

export function vectorDocumentAdapterContract<Document, Selection>(
	name: string,
	createHarness: () => VectorAdapterContractHarness<Document, Selection>,
): void {
	describe(`${name} vector document adapter contract`, () => {
		it("projects selection and neutral clipboard geometry through one contract", () => {
			const harness = createHarness()
			const snapshot = harness.adapter.project(
				harness.document,
				harness.selection,
			)
			expect(snapshot.objects.length).toBeGreaterThan(0)
			expect(snapshot.selection.length).toBeGreaterThan(0)
			expect(
				harness.adapter
					.clipboard(harness.document, harness.selection)
					.objects.map((object) => object.id),
			).toContain(harness.selectedObjectId)
		})

		it("commits update/delete intents and rejects invalid edits atomically", () => {
			const harness = createHarness()
			const snapshot = harness.adapter.project(
				harness.document,
				harness.selection,
			)
			const object = snapshot.objects.find(
				(candidate) => candidate.id === harness.selectedObjectId,
			)
			if (object === undefined)
				throw new Error("Contract harness selected object is missing.")
			const updated = harness.adapter.apply(
				harness.document,
				harness.selection,
				harness.update(object, snapshot.selection),
			)
			expect(updated.ok).toBe(true)
			if (!updated.ok) return
			harness.assertUpdated(updated.document)
			const rejected = harness.adapter.apply(
				updated.document,
				updated.selection,
				harness.invalid,
			)
			expect(rejected).toMatchObject({ ok: false })
			harness.assertUpdated(updated.document)
			const deleted = harness.adapter.apply(
				updated.document,
				updated.selection,
				harness.remove(object, snapshot.selection),
			)
			expect(deleted.ok).toBe(true)
			if (deleted.ok) harness.assertDeleted(deleted.document)
		})
	})
}
