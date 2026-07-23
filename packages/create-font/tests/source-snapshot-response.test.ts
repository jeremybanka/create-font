import { describe, expect, it } from "bun:test"

import { sourceProjectSnapshotFromResponse } from "../public/source-snapshot-response.ts"

describe(`source snapshot response`, () => {
	it(`returns one revision-consistent project snapshot`, () => {
		const snapshot = {
			revision: `manifest-1`,
			units: [
				{
					path: `names.json`,
					revision: `names-1`,
					value: { family: `Workbench Sans` },
				},
			],
		}

		expect(
			sourceProjectSnapshotFromResponse({ data: snapshot, error: null }),
		).toBe(snapshot)
	})

	it(`reports an unavailable source without exposing the transport body`, () => {
		expect(() =>
			sourceProjectSnapshotFromResponse({
				data: {
					code: `source.not_ready`,
					message: `The font source service has not been configured yet.`,
				},
				error: null,
			}),
		).toThrow(`Font source is not available.`)
	})

	it(`reports snapshot transport failures with their HTTP status`, () => {
		expect(() =>
			sourceProjectSnapshotFromResponse({
				data: null,
				error: { status: 503 },
			}),
		).toThrow(`Read source snapshot failed with HTTP 503.`)
	})
})
