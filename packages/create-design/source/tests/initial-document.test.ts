import { describe, expect, it } from "vitest"

import {
	createInitialDocument,
	IDENTITY_DESIGN_TRANSFORM,
} from "../src/initial-document.ts"
import { validateDesignDocument } from "../src/document.ts"

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
})
