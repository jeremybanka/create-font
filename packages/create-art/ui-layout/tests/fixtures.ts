import type { UiLayoutRecordV1 } from "../src/schema.ts"

const columns = [1, 2, 3, 4].map((id) => ({
	id: id as 1 | 2 | 3 | 4,
	alignment: id === 4 ? ("bottom" as const) : ("top" as const),
	collapsed: id === 2,
	tiles: id === 1 ? [{ id: "layers:1", kind: "layers", fill: true }] : [],
}))
const primary = Array.from({ length: 12 }, (_, index) =>
	index === 0 ? "select" : null,
)
const alternate = Array.from({ length: 12 }, (_, index) =>
	index === 0 ? "rule" : null,
)

export const fontLayout = {
	version: 1,
	id: "font-authoring",
	name: "Authoring",
	product: "create-font",
	state: {
		tiling: { version: 3, columns },
		hotbars: { primary, alternate },
		preferences: { diffView: false },
	},
} satisfies UiLayoutRecordV1

export const designLayout = {
	version: 1,
	id: "design-review",
	name: "Review",
	product: "create-design",
	state: {
		tiling: { version: 3, columns },
		hotbars: { primary, alternate },
		preferences: { canvasDimmer: 71 },
	},
} satisfies UiLayoutRecordV1
