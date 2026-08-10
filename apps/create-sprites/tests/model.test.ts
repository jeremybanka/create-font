import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
	celPixels,
	compositeFrame,
	createSpriteProject,
	decodeRows,
	encodeRows,
	floodFill,
	linePoints,
	normalizeSpriteProject,
	paintPoints,
	setCelPixels,
	TRANSPARENT_PIXEL,
} from "../src/model.ts"

describe("sprite model", () => {
	it("round-trips reviewable indexed cel rows", () => {
		const pixels = new Uint8Array([0, 1, TRANSPARENT_PIXEL, 2, 3, 4])
		const rows = encodeRows(pixels, 3, 2)
		assert.deepEqual(rows, ["01.", "234"])
		assert.deepEqual([...decodeRows(rows, 3, 2, 5)], [...pixels])
	})

	it("paints gap-free integer lines with symmetry", () => {
		const points = linePoints({ x: 1, y: 1 }, { x: 4, y: 2 })
		const pixels = paintPoints(new Uint8Array(36).fill(TRANSPARENT_PIXEL), 6, 6, points, 2, 1, true)
		assert.equal(pixels[1 * 6 + 1], 2)
		assert.equal(pixels[1 * 6 + 4], 2)
		assert.equal(pixels[2 * 6 + 1], 2)
		assert.equal(pixels[2 * 6 + 4], 2)
	})

	it("fills only the connected indexed region", () => {
		const pixels = new Uint8Array([0, 0, 1, 0, 1, 1, 0, 0, 1])
		assert.deepEqual([...floodFill(pixels, 3, 3, { x: 0, y: 0 }, 2)], [2, 2, 1, 2, 1, 1, 2, 2, 1])
	})

	it("composites visible cel colors", () => {
		const source = createSpriteProject("Test", 2, 1)
		const project = setCelPixels(source, "frame-1", "art", new Uint8Array([0, TRANSPARENT_PIXEL]))
		assert.deepEqual([...compositeFrame(project, "frame-1")], [23, 20, 31, 255, 0, 0, 0, 0])
		assert.deepEqual([...celPixels(project, "frame-1", "art")], [0, TRANSPARENT_PIXEL])
	})

	it("rejects cels with unavailable palette symbols", () => {
		const project = createSpriteProject("Test", 1, 1)
		assert.throws(() => normalizeSpriteProject({ ...project, cels: [{ frameId: "frame-1", layerId: "art", rows: ["_"] }] }), /unavailable palette symbol/)
	})
})
