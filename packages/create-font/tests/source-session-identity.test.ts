import { CREATE_FONT_EDITOR_VERSION } from "@create-font/states"
import { describe, expect, it } from "vitest"

import {
	SOURCE_SESSION_PROTOCOL_VERSION,
	SOURCE_SESSION_WORKER_NAME,
	sourceSessionWorkerName,
} from "../public/source-session-identity.ts"

describe("source-session SharedWorker identity", () => {
	it("rolls over when the editor or worker source protocol changes", () => {
		expect(sourceSessionWorkerName(4, 2)).not.toBe(
			sourceSessionWorkerName(5, 2),
		)
		expect(sourceSessionWorkerName(5, 1)).not.toBe(
			sourceSessionWorkerName(5, 2),
		)
		expect(SOURCE_SESSION_WORKER_NAME).toBe(
			`create-font-source-session-v${CREATE_FONT_EDITOR_VERSION}.${SOURCE_SESSION_PROTOCOL_VERSION}`,
		)
	})
})
