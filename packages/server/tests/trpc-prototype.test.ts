import { EventEmitter, on } from "node:events"

import { initTRPC, tracked } from "@trpc/server"
import { createHTTPServer } from "@trpc/server/adapters/standalone"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import type { SourceChangedEvent } from "../src/contracts.ts"

const sourceEvents = new EventEmitter()
const subscriptionInputs: (string | null)[] = []
const t = initTRPC.create()
const prototypeRouter = t.router({
	health: t.procedure.query(() => ({ ok: true })),
	write: t.procedure
		.input(z.object({ revision: z.string() }))
		.mutation(({ input }) => input),
	events: t.procedure
		.input(z.object({ lastEventId: z.string().nullish() }).optional())
		.subscription(async function* ({ input, signal }) {
			subscriptionInputs.push(input?.lastEventId ?? null)
			for await (const [event] of on(sourceEvents, `source`, { signal })) {
				const sourceEvent = event as SourceChangedEvent
				yield tracked(sourceEvent.revision, sourceEvent)
			}
		}),
})

type PrototypeServer = ReturnType<typeof createHTTPServer>
const activeServers = new Set<PrototypeServer>()
const activeSubscriptions = new Set<AbortController>()

async function startPrototype(): Promise<{
	origin: string
	server: PrototypeServer
}> {
	const server = createHTTPServer({ router: prototypeRouter })
	await new Promise<void>((resolve, reject) => {
		server.once(`error`, reject)
		server.listen(0, `127.0.0.1`, resolve)
	})
	activeServers.add(server)
	const address = server.address()
	if (address === null || typeof address === `string`) {
		throw new Error(`The tRPC prototype did not allocate a TCP port.`)
	}
	return {
		origin: `http://127.0.0.1:${address.port}`,
		server,
	}
}

async function openSubscription(
	origin: string,
	lastEventId?: string,
): Promise<{
	controller: AbortController
	reader: ReadableStreamDefaultReader<Uint8Array>
}> {
	const controller = new AbortController()
	activeSubscriptions.add(controller)
	const response = await fetch(`${origin}/events`, {
		headers: {
			accept: `text/event-stream`,
			...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
		},
		signal: controller.signal,
	})
	expect(response.status).toBe(200)
	expect(response.headers.get(`content-type`)).toContain(`text/event-stream`)
	if (response.body === null) throw new Error(`The SSE response has no body.`)
	return { controller, reader: response.body.getReader() }
}

async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	fragment: string,
): Promise<string> {
	const decoder = new TextDecoder()
	let text = ``
	while (!text.includes(fragment)) {
		const result = await reader.read()
		if (result.done) {
			throw new Error(`The SSE stream ended before ${fragment}.`)
		}
		text += decoder.decode(result.value, { stream: true })
	}
	return text
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 5_000
	while (!predicate()) {
		if (performance.now() >= deadline) {
			throw new Error(`Timed out waiting for prototype state.`)
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

afterEach(async () => {
	for (const controller of activeSubscriptions) controller.abort()
	activeSubscriptions.clear()
	await Promise.all(
		[...activeServers].map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.close((error) =>
						error === undefined ? resolve() : reject(error),
					)
					server.closeAllConnections()
				}),
		),
	)
	activeServers.clear()
	sourceEvents.removeAllListeners()
	subscriptionInputs.length = 0
})

describe(`tRPC transport prototype`, () => {
	it(`supports query, mutation, fan-out, cleanup, and tracked reconnect input`, async () => {
		const { origin } = await startPrototype()
		const health = await fetch(`${origin}/health`)
		expect(await health.json()).toEqual({
			result: { data: { ok: true } },
		})

		const write = await fetch(`${origin}/write`, {
			body: JSON.stringify({ revision: `project-a` }),
			headers: { "content-type": `application/json` },
			method: `POST`,
		})
		expect(await write.json()).toEqual({
			result: { data: { revision: `project-a` } },
		})

		const first = await openSubscription(origin)
		const second = await openSubscription(origin)
		await waitFor(() => sourceEvents.listenerCount(`source`) === 2)

		const event: SourceChangedEvent = {
			type: `source.changed`,
			previousRevision: `project-a`,
			removedPaths: [],
			revision: `project-b`,
			units: [],
		}
		sourceEvents.emit(`source`, event)
		const [firstMessage, secondMessage] = await Promise.all([
			readUntil(first.reader, event.revision),
			readUntil(second.reader, event.revision),
		])
		expect(firstMessage).toContain(`"type":"source.changed"`)
		expect(secondMessage).toContain(`"type":"source.changed"`)

		second.controller.abort()
		activeSubscriptions.delete(second.controller)
		await waitFor(() => sourceEvents.listenerCount(`source`) === 1)

		const reconnected = await openSubscription(origin, event.revision)
		await waitFor(() => sourceEvents.listenerCount(`source`) === 2)
		expect(subscriptionInputs).toContain(event.revision)
		reconnected.controller.abort()
		activeSubscriptions.delete(reconnected.controller)
	})
})
