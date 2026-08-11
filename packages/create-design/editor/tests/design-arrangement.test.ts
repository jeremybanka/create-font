import { describe, expect, it } from "vitest"

import {
	alignDesignObjects,
	distributeDesignObjects,
	transformDesignSelection,
} from "../src/design-arrangement.ts"
import { createInitialDocument } from "../src/document.ts"
import { groupDesignSelection } from "../src/design-hierarchy.ts"
import {
	createDesignTextObject,
	scaleDesignTextObject,
} from "../src/design-text.ts"
import { makeDesignClippingMask } from "../src/design-hierarchy.ts"
import {
	scaleObject,
	translateObject,
	visibleObjectBounds,
} from "@create-design/model"

const textObject = (mode: "point" | "area") => {
	const document = createInitialDocument()
	return createDesignTextObject({
		id: `object:${mode}-text`,
		name: `${mode} text`,
		mode,
		x: 40,
		y: 80,
		width: 160,
		height: 72,
		text: "Scale me",
		appearance: document.objects[0]!.appearance,
		typography: {
			font: { id: "font:test", family: "Test" },
			size: 20,
			leading: 24,
			tracking: 25,
			kerning: "auto",
			alignment: "start",
			direction: "ltr",
		},
	})
}

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

	it("scales a clipping mask from its clipping contour bounds", () => {
		const initial = createInitialDocument()
		const content = translateObject(initial.objects[0]!, 500, 300)
		const clippingPath = initial.objects[1]!
		const source = { ...initial, objects: [content, clippingPath] }
		const masked = makeDesignClippingMask(
			source,
			source.objects.map(({ id }) => id),
			() => "numeric-transform",
		)
		if (masked === null) throw new Error("Expected clipping mask to succeed.")
		const before = visibleObjectBounds(clippingPath)!
		const result = transformDesignSelection(masked.document, masked.selection, {
			origin: "top-left",
			width: 2 * (before.maxX - before.minX),
		})
		const transformedClip = result?.objects.find(
			({ id }) => id === clippingPath.id,
		)
		const after =
			transformedClip === undefined
				? null
				: visibleObjectBounds(transformedClip)

		expect(after?.minX).toBeCloseTo(before.minX)
		expect(after?.minY).toBeCloseTo(before.minY)
		expect(after === null ? null : after.maxX - after.minX).toBeCloseTo(
			2 * (before.maxX - before.minX),
		)
	})

	it.each(["point", "area"] as const)(
		"absorbs repeated proportional %s text resizing into canonical typography",
		(mode) => {
			const initial = createInitialDocument()
			const text = textObject(mode)
			const document = { ...initial, objects: [text] }
			const before = visibleObjectBounds(text)!
			const twice = transformDesignSelection(document, [text.id], {
				origin: "top-left",
				width: 2 * (before.maxX - before.minX),
			})!
			const first = twice.objects[0]!
			if (first.geometry.kind !== "text") throw new Error("Expected text.")
			expect(first.geometry.typography.size).toBeCloseTo(40)
			expect(first.geometry.typography.leading).toBeCloseTo(48)
			expect(first.geometry.x).toBeCloseTo(80)
			expect(first.geometry.y).toBeCloseTo(160)
			expect(first.geometry.typography.tracking).toBe(25)
			expect(first.transform.a).toBeCloseTo(1)
			expect(first.transform.d).toBeCloseTo(1)
			if (mode === "area") {
				expect(first.geometry.frame?.width).toBeCloseTo(320)
				expect(first.geometry.frame?.height).toBeCloseTo(144)
				expect(first.geometry.frame?.inset.top).toBeCloseTo(16)
			}

			const firstBounds = visibleObjectBounds(first)!
			const fourTimes = transformDesignSelection(twice, [text.id], {
				origin: "top-left",
				width: 2 * (firstBounds.maxX - firstBounds.minX),
			})!
			const repeated = fourTimes.objects[0]!
			if (repeated.geometry.kind !== "text") throw new Error("Expected text.")
			expect(repeated.geometry.typography.size).toBeCloseTo(80)
			expect(repeated.transform.a).toBeCloseTo(1)
			expect(repeated.transform.d).toBeCloseTo(1)
		},
	)

	it("keeps a mixed selection proportional when text is resized", () => {
		const initial = createInitialDocument()
		const text = textObject("point")
		const path = initial.objects[0]!
		const document = { ...initial, objects: [path, text] }
		const before = visibleObjectBounds(path)!
		const combined = document.objects
			.map((object) => visibleObjectBounds(object)!)
			.reduce((bounds, item) => ({
				minX: Math.min(bounds.minX, item.minX),
				minY: Math.min(bounds.minY, item.minY),
				maxX: Math.max(bounds.maxX, item.maxX),
				maxY: Math.max(bounds.maxY, item.maxY),
			}))
		const result = transformDesignSelection(document, [path.id, text.id], {
			origin: "top-left",
			width: 1.5 * (combined.maxX - combined.minX),
			height: 10,
		})!
		const scaledPath = result.objects[0]!
		const scaledText = result.objects[1]!
		if (scaledText.geometry.kind !== "text") throw new Error("Expected text.")
		expect(scaledText.geometry.typography.size).toBeCloseTo(30)
		expect(scaledText.transform.a).toBeCloseTo(1)
		expect(scaledPath.transform.a).toBeCloseTo(path.transform.a * 1.5)
		expect(scaledPath.transform.d).toBeCloseTo(path.transform.d * 1.5)
		const after = visibleObjectBounds(scaledPath)!
		expect(after.maxX - after.minX).toBeCloseTo(
			1.5 * (before.maxX - before.minX),
		)
	})

	it("preserves anchored world geometry while canonicalizing reflected text", () => {
		const text = textObject("area")
		const anchor = { x: 12, y: 34 }
		const canonical = scaleDesignTextObject(text, anchor, -1.25)
		const generic = scaleObject(text, anchor, -1.25, -1.25)
		expect(visibleObjectBounds(canonical)).toEqual(visibleObjectBounds(generic))
		if (canonical.geometry.kind !== "text") throw new Error("Expected text.")
		expect(canonical.geometry.typography.size).toBe(25)
		expect(canonical.transform.a).toBe(-1)
		expect(canonical.transform.d).toBe(-1)
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

	it("keeps the rigid unit containing a key object stationary", () => {
		const document = createInitialDocument()
		const grouped = groupDesignSelection(
			document,
			document.objects.map(({ id }) => id),
			() => "key-unit",
		)!
		const result = alignDesignObjects(
			grouped.document,
			grouped.selection,
			"right",
			"key-object",
			document.artboards[0]!,
			grouped.selection[0],
		)!
		expect(result.objects).toEqual(grouped.document.objects)
		expect(
			result.objects.every(
				(object, index) => object === grouped.document.objects[index],
			),
		).toBe(true)
	})
})
