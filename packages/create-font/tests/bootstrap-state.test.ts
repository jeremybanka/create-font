import { describe, expect, it } from "bun:test"

import {
	bootstrapDocumentTitle,
	INITIAL_BOOTSTRAP_STATE,
	nextBootstrapState,
} from "../public/bootstrap-state.ts"

describe(`font-source bootstrap state`, () => {
	it(`moves from loading to a readable error and back to loading`, () => {
		const failed = nextBootstrapState(INITIAL_BOOTSTRAP_STATE, {
			type: `fail`,
			message: `Read source inventory failed with HTTP 503.`,
		})
		expect(failed).toEqual({
			type: `error`,
			message: `Read source inventory failed with HTTP 503.`,
		})
		expect(bootstrapDocumentTitle(failed)).toBe(
			`Unable to open font — create-font`,
		)

		const retried = nextBootstrapState(failed, { type: `retry` })
		expect(retried).toBe(INITIAL_BOOTSTRAP_STATE)
		expect(bootstrapDocumentTitle(retried)).toBe(
			`Loading font source — create-font`,
		)
	})

	it(`replaces an empty transport error with useful copy`, () => {
		expect(
			nextBootstrapState(INITIAL_BOOTSTRAP_STATE, {
				type: `fail`,
				message: `  `,
			}),
		).toEqual({
			type: `error`,
			message: `The font source could not be opened.`,
		})
	})
})
