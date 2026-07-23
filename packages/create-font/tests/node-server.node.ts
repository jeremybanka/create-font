import { test } from "node:test"

import { verifyRuntimeServer } from "./runtime-server-smoke.ts"

test(`serves HTTP, assets, and source events with the Node adapter`, () =>
	verifyRuntimeServer())
