import { describe, expect, it } from "vitest"

import {
	alignDesignObjects,
	distributeDesignObjects,
	transformDesignSelection,
} from "../src/design-arrangement.ts"
import { createInitialDocument } from "../src/document.ts"
import { groupDesignSelection } from "../src/design-hierarchy.ts"
import { visibleObjectBounds } from "@create-design/model"

describe("design arrangement", () => {
	it("aligns mixed objects to selection, key object, and artboard", () => {
		const document = createInitialDocument()
		const ids = document.objects.map((object) => object.id)
		const left = alignDesignObjects(
			document,
			ids,
			"left",
			"artboard",
			document.artboards[0]!,
		)!
		expect(
			left.objects.map((object) => visibleObjectBounds(object)?.minX),
		).toEqual([0, 0])
		const key = alignDesignObjects(
			document,
			ids,
			"bottom",
			"key-object",
			document.artboards[0]!,
			ids[0],
		)!
		expect(
			key.objects.map((object) => visibleObjectBounds(object)?.maxY),
		).toEqual([342, 342])
	})

	it("distributes mixed sizes stably while holding endpoints", () => {
		const document = createInitialDocument()
		const first = document.objects[0]!
		const objects = [
			first,
			{ ...first, id: "object:b", transform: { ...first.transform, e: 500 } },
			{ ...first, id: "object:c", transform: { ...first.transform, e: 900 } },
		]
		const result = distributeDesignObjects(
			{ ...document, objects },
			objects.map((object) => object.id),
			"x",
		)!
		expect(result.objects[0]).toBe(first)
		expect(result.objects[2]).toBe(objects[2])
		expect(visibleObjectBounds(result.objects[1]!)?.minX).toBe(532)
	})

	it("shares finite transform semantics across numeric and canvas edits", () => {
		const document = createInitialDocument()
		const ids = document.objects.map((object) => object.id)
		const result = transformDesignSelection(document, ids, {
			origin: "center",
			width: 614,
			constrainProportions: true,
			x: 306,
			y: 396,
			rotation: 30,
		})!
		expect(
			result.objects
				.flatMap((object) => Object.values(object.transform))
				.every(Number.isFinite),
		).toBe(true)
		expect(
			transformDesignSelection(document, ids, {
				origin: "center",
				width: Number.NaN,
			}),
		).toBeNull()
	})

	it("leaves locked and hidden objects unchanged deterministically", () => {
		const document = createInitialDocument()
		const objects = [
			{ ...document.objects[0]!, locked: true },
			{ ...document.objects[1]!, hidden: true },
		]
		const result = alignDesignObjects(
			{ ...document, objects },
			objects.map((object) => object.id),
			"left",
			"artboard",
			document.artboards[0]!,
		)
		expect(result).toBeNull()
	})

	it("transforms complete groups as one deterministic unit", () => {
		const document = createInitialDocument()
		const grouped = groupDesignSelection(
			document,
			document.objects.map((object) => object.id),
			() => "arrangement",
		)!
		const before = grouped.document.objects.map((object) => object.transform.e)
		const result = alignDesignObjects(
			grouped.document,
			grouped.selection,
			"left",
			"artboard",
			document.artboards[0]!,
		)!
		const deltas = result.objects.map(
			(object, index) => object.transform.e - before[index]!,
		)
		expect(new Set(deltas).size).toBe(1)
	})
})
