import { createInitialDocument } from "@create-design/source"
import { describe, expect, test } from "vitest"

import { defaultDesignHierarchyScope } from "../src/design-hierarchy.ts"
import { placeDesignLinkedArtboard } from "../src/linked-artboards.ts"

test("places a linked artboard as one transformable hierarchy object", () => {
	const document = createInitialDocument()
	const source = createInitialDocument()
	const placed = placeDesignLinkedArtboard(
		document,
		{ projectId: "source", revision: "r1", document: source },
		source.artboards[0]!,
		document.artboards[0]!,
		defaultDesignHierarchyScope(document),
		() => "linked",
	)
	expect(placed.object.geometry).toMatchObject({
		kind: "artboard-link",
		projectId: "source",
		artboardId: source.artboards[0]!.id,
	})
	expect(
		placed.document.layers[0]?.children.some(
			(child) => child.kind === "object" && child.id === placed.object.id,
		),
	).toBe(true)
})
