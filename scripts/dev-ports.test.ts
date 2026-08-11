import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
	CREATE_DESIGN_CLI_DEV_PORT,
	CREATE_FONT_CLI_DEV_PORT,
	DEFAULT_DEV_PORT,
	resolveDevPort,
	workspaceDevPorts,
} from "./dev-ports.ts"

describe(`development ports`, () => {
	it(`allocates the four workspace servers consecutively`, () => {
		assert.deepEqual(workspaceDevPorts(DEFAULT_DEV_PORT), {
			createFontFrontend: 16_384,
			createFontBackend: 16_385,
			createDesignFrontend: 16_386,
			createDesignBackend: 16_387,
		})
	})

	it(`reserves distinctive single-origin CLI ports`, () => {
		assert.equal(CREATE_FONT_CLI_DEV_PORT, 16_384)
		assert.equal(CREATE_DESIGN_CLI_DEV_PORT, 16_386)
		assert.notEqual(CREATE_FONT_CLI_DEV_PORT, CREATE_DESIGN_CLI_DEV_PORT)
	})

	it(`accepts spaced and equals-style command line overrides`, () => {
		assert.equal(
			resolveDevPort({
				argv: [`--port`, `20000`],
				defaultPort: DEFAULT_DEV_PORT,
				portCount: 4,
			}),
			20_000,
		)
		assert.equal(
			resolveDevPort({
				argv: [`--port=21000`],
				defaultPort: DEFAULT_DEV_PORT,
				portCount: 4,
			}),
			21_000,
		)
	})

	it(`prefers the command line over the environment`, () => {
		assert.equal(
			resolveDevPort({
				defaultPort: DEFAULT_DEV_PORT,
				environmentValue: `23000`,
				portCount: 4,
			}),
			23_000,
		)
		assert.equal(
			resolveDevPort({
				argv: [`--port=22000`],
				defaultPort: DEFAULT_DEV_PORT,
				environmentValue: `23000`,
				portCount: 4,
			}),
			22_000,
		)
	})

	it(`rejects invalid and overflowing port blocks`, () => {
		assert.throws(
			() =>
				resolveDevPort({
					argv: [`--port=font`],
					defaultPort: DEFAULT_DEV_PORT,
					portCount: 4,
				}),
			/--port must be an integer/,
		)
		assert.throws(
			() =>
				resolveDevPort({
					argv: [`--port=65534`],
					defaultPort: DEFAULT_DEV_PORT,
					portCount: 4,
				}),
			/leave room for 4 consecutive TCP ports/,
		)
	})
})
