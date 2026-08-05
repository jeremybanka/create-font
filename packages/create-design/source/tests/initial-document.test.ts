import { describe, expect, it } from "vitest"

import {
	createInitialDocument,
	IDENTITY_DESIGN_TRANSFORM,
} from "../src/initial-document.ts"
import { validateDesignDocument } from "../src/document.ts"
import {
	DESIGN_LAYER_UI_COLORS,
	designLayerUiColorAt,
	nextDesignLayerUiColor,
} from "../src/layer-ui-color.ts"

describe("initial design document", () => {
	it("is a valid canonical document with shared identity transforms", () => {
		const document = createInitialDocument()
		expect(validateDesignDocument(document).ok).toBe(true)
		expect(document.objects).not.toHaveLength(0)
		expect(
			document.objects.every(
				(object) => object.transform === IDENTITY_DESIGN_TRANSFORM,
			),
		).toBe(true)
	})

	it("assigns layer UI colors in the standard order and cycles deterministically", () => {
		expect(DESIGN_LAYER_UI_COLORS).toEqual([
			"red",
			"blue",
			"yellow",
			"purple",
			"green",
			"pink",
			"cyan",
			"orange",
			"indigo",
			"lime",
			"magenta",
			"teal",
		])
		expect(designLayerUiColorAt(12)).toBe("red")
		expect(nextDesignLayerUiColor(["red", "yellow"])).toBe("blue")
		expect(nextDesignLayerUiColor(DESIGN_LAYER_UI_COLORS)).toBe("red")

		const initial = createInitialDocument()
		const decoded = validateDesignDocument({
			...initial,
			layers: Array.from({ length: 14 }, (_, index) => ({
				id: `layer:${index}`,
				name: `Layer ${index}`,
				children: index === 0 ? initial.layers[0]!.children : [],
			})),
		})
		if (!decoded.ok) throw new Error("Expected legacy colors to normalize.")
		expect(decoded.value.layers.map(({ uiColor }) => uiColor)).toEqual([
			...DESIGN_LAYER_UI_COLORS,
			"red",
			"blue",
		])
	})
})
