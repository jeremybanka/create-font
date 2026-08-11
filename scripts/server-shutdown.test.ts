import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { describe, it } from "node:test"

import {
	installServerShutdown,
	type ServerShutdownRuntime,
} from "./server-shutdown.ts"

function deferred(): Readonly<{
	promise: Promise<void>
	resolve: () => void
}> {
	let resolve!: () => void
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe(`server signal shutdown`, () => {
	it(`stops once, records signal status, and removes listeners`, async () => {
		const events = new EventEmitter()
		const stopping = deferred()
		let exitCode: number | undefined
		let forcedExit: number | undefined
		let stops = 0
		const runtime: ServerShutdownRuntime = {
			exit: (code) => {
				forcedExit = code
				return undefined as never
			},
			on: (signal, listener) => events.on(signal, listener),
			off: (signal, listener) => events.off(signal, listener),
			setExitCode: (code) => {
				exitCode = code
			},
		}
		installServerShutdown({
			runtime,
			stop: () => {
				stops += 1
				return stopping.promise
			},
		})

		events.emit(`SIGINT` satisfies NodeJS.Signals)
		await Promise.resolve()
		assert.equal(stops, 1)
		assert.equal(exitCode, 130)
		stopping.resolve()
		await stopping.promise
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(forcedExit, 130)
		assert.equal(events.listenerCount(`SIGINT`), 0)
		assert.equal(events.listenerCount(`SIGTERM`), 0)
	})

	it(`forces exit when interrupted again during cleanup`, async () => {
		const events = new EventEmitter()
		const stopping = deferred()
		let exitCalls = 0
		let forcedExit: number | undefined
		const runtime: ServerShutdownRuntime = {
			exit: (code) => {
				exitCalls += 1
				forcedExit = code
				if (exitCalls === 1) throw new Error(`forced exit`)
				return undefined as never
			},
			on: (signal, listener) => events.on(signal, listener),
			off: (signal, listener) => events.off(signal, listener),
			setExitCode: () => {},
		}
		installServerShutdown({ runtime, stop: () => stopping.promise })

		events.emit(`SIGTERM` satisfies NodeJS.Signals)
		assert.throws(
			() => events.emit(`SIGTERM` satisfies NodeJS.Signals),
			/forced exit/,
		)
		assert.equal(forcedExit, 143)
		stopping.resolve()
		await new Promise((resolve) => setImmediate(resolve))
	})

	it(`forces the signal status when graceful shutdown fails`, async () => {
		const events = new EventEmitter()
		let forcedExit: number | undefined
		const runtime: ServerShutdownRuntime = {
			exit: (code) => {
				forcedExit = code
				return undefined as never
			},
			on: (signal, listener) => events.on(signal, listener),
			off: (signal, listener) => events.off(signal, listener),
			setExitCode: () => {},
		}
		installServerShutdown({
			runtime,
			stop: () => Promise.reject(new Error(`stop failed`)),
		})

		events.emit(`SIGINT` satisfies NodeJS.Signals)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(forcedExit, 130)
	})
})
