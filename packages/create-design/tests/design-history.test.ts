import { describe, expect, it } from "vitest"

import {
	createDesignHistory,
	reduceDesignHistory,
} from "../src/design-history.ts"
import { createDesignPenObject } from "../src/design-pen.ts"
import { createInitialDocument, parseDesignDocument } from "../src/document.ts"

describe("design Pen timeline", () => {
	const completedPenDocument = () => {
		const document = createInitialDocument()
		const object = createDesignPenObject({
			id: "object:pen",
			name: "Pen path 3",
			appearance: { fill: { swatchId: "swatch:coral" } },
			points: [
				{ x: 40, y: 50 },
				{
					x: 160,
					y: 90,
					incoming: { x: -30, y: -20 },
					outgoing: { x: 30, y: 20 },
				},
				{ x: 210, y: 180 },
			],
			closed: false,
		})
		if (object === null) throw new TypeError("Expected a Pen object.")
		return { ...document, objects: [...document.objects, object] }
	}

	it("commits a completed contour as one atomic undo/redo operation", () => {
		const initial = createInitialDocument()
		const committed = reduceDesignHistory(createDesignHistory(initial), {
			type: "commit",
			document: completedPenDocument(),
		})
		expect(committed.past).toHaveLength(1)
		expect(committed.present.objects).toHaveLength(initial.objects.length + 1)

		const undone = reduceDesignHistory(committed, { type: "undo" })
		expect(undone.present.objects).toHaveLength(initial.objects.length)
		expect(undone.future).toHaveLength(1)

		const redone = reduceDesignHistory(undone, { type: "redo" })
		expect(redone.present.objects.at(-1)?.id).toBe("object:pen")
		expect(redone.past).toHaveLength(1)
	})

	it("invalidates redo after a different commit", () => {
		const initial = createInitialDocument()
		const committed = reduceDesignHistory(createDesignHistory(initial), {
			type: "commit",
			document: completedPenDocument(),
		})
		const undone = reduceDesignHistory(committed, { type: "undo" })
		const replacement = { ...initial, title: "Replacement" }
		const changed = reduceDesignHistory(undone, {
			type: "commit",
			document: replacement,
		})
		expect(changed.future).toEqual([])
		expect(reduceDesignHistory(changed, { type: "redo" })).toBe(changed)
	})

	it("round-trips completed Pen nodes and handles through persistence", () => {
		const document = completedPenDocument()
		const restored = parseDesignDocument(JSON.stringify(document))
		expect(restored?.objects.at(-1)).toEqual(document.objects.at(-1))
		const geometry = restored?.objects.at(-1)?.geometry
		expect(
			geometry?.kind === "path"
				? geometry.contours[0]?.points[1]?.outgoing
				: undefined,
		).toEqual({ x: 30, y: 20 })
	})
})
