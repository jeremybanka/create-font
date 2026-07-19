import { CREATE_FONT_EDITOR_VERSION } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	SOURCE_SESSION_WORKER_NAME,
	sourceSessionWorkerName,
} from "../public/source-session-identity.ts"

describe("source-session SharedWorker identity", () => {
	it("rolls over when the editor source contract changes", () => {
		expect(sourceSessionWorkerName(4)).not.toBe(sourceSessionWorkerName(5))
		expect(SOURCE_SESSION_WORKER_NAME).toBe(
			`create-font-source-session-v${CREATE_FONT_EDITOR_VERSION}`,
		)
	})
})
