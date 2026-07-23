import assert from "node:assert/strict"
import { createServer } from "node:net"
import { test } from "node:test"

import type {
	CreateFontSourceService,
	SourceChangedEvent,
} from "@create-font/server"

import { startCreateFontServer } from "../src/server.ts"

async function availablePort(): Promise<number> {
	const server = createServer()
	await new Promise<void>((resolve, reject) => {
		server.once(`error`, reject)
		server.listen(0, `127.0.0.1`, resolve)
	})
	const address = server.address()
	if (address === null || typeof address === `string`) {
		throw new Error(`Node did not allocate a TCP port.`)
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)))
	})
	return address.port
}

function nextEvent<EventType extends Event>(
	target: EventTarget,
	type: string,
): Promise<EventType> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`Timed out waiting for ${type}.`)),
			5_000,
		)
		target.addEventListener(
			type,
			(event) => {
				clearTimeout(timeout)
				resolve(event as EventType)
			},
			{ once: true },
		)
	})
}

async function connectSocket(url: URL): Promise<WebSocket> {
	const socket = new WebSocket(url)
	await nextEvent(socket, `open`)
	return socket
}

async function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) return
	const closed = nextEvent(socket, `close`)
	socket.close()
	await closed
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 5_000
	while (!predicate()) {
		if (performance.now() >= deadline) {
			throw new Error(`Timed out waiting for server state.`)
		}
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
}

test(`serves HTTP, assets, and source events with the Node adapter`, async () => {
	const sourceListeners = new Set<(event: SourceChangedEvent) => void>()
	const source: CreateFontSourceService = {
		readManifest: async () => ({ revision: `project-a`, units: [] }),
		readSnapshot: async () => ({ revision: `project-a`, units: [] }),
		readUnit: async (path) => {
			throw new Error(`Unexpected unit read: ${path}`)
		},
		subscribe(listener) {
			sourceListeners.add(listener)
			return () => sourceListeners.delete(listener)
		},
		writeUnit: async () => {
			throw new Error(`Unexpected unit write.`)
		},
		writeUnits: async () => {
			throw new Error(`Unexpected multi-unit write.`)
		},
	}
	const port = await availablePort()
	const server = startCreateFontServer({ port, source })
	const sockets = new Set<WebSocket>()
	try {
		assert.equal(server.url.href, `http://127.0.0.1:${port}/`)

		const health = await fetch(new URL(`/api/health`, server.url))
		assert.equal(health.status, 200)
		assert.deepEqual(await health.json(), {
			ok: true,
			rpcVersion: 6,
		})

		const editor = await fetch(new URL(`/editor/editor.js`, server.url))
		assert.equal(editor.status, 200)
		assert.match(editor.headers.get(`content-type`) ?? ``, /text\/javascript/u)
		assert.match(await editor.text(), /mountEditor/u)

		const eventsUrl = new URL(`/api/source/events`, server.url)
		eventsUrl.protocol = `ws:`
		const first = await connectSocket(eventsUrl)
		const second = await connectSocket(eventsUrl)
		sockets.add(first)
		sockets.add(second)
		assert.equal(sourceListeners.size, 2)

		const event: SourceChangedEvent = {
			type: `source.changed`,
			previousRevision: `project-a`,
			removedPaths: [],
			revision: `project-b`,
			units: [],
		}
		const firstMessage = nextEvent<MessageEvent<string>>(first, `message`)
		const secondMessage = nextEvent<MessageEvent<string>>(second, `message`)
		for (const listener of sourceListeners) listener(event)
		assert.deepEqual(JSON.parse((await firstMessage).data), event)
		assert.deepEqual(JSON.parse((await secondMessage).data), event)

		await closeSocket(second)
		sockets.delete(second)
		await waitFor(() => sourceListeners.size === 1)
		const reconnected = await connectSocket(eventsUrl)
		sockets.add(reconnected)
		assert.equal(sourceListeners.size, 2)

		const reconnectedEvent: SourceChangedEvent = {
			type: `source.changed`,
			previousRevision: `project-b`,
			removedPaths: [`glyphs/removed.json`],
			revision: `project-c`,
			units: [],
		}
		const firstReconnectedMessage = nextEvent<MessageEvent<string>>(
			first,
			`message`,
		)
		const secondReconnectedMessage = nextEvent<MessageEvent<string>>(
			reconnected,
			`message`,
		)
		for (const listener of sourceListeners) listener(reconnectedEvent)
		assert.deepEqual(
			JSON.parse((await firstReconnectedMessage).data),
			reconnectedEvent,
		)
		assert.deepEqual(
			JSON.parse((await secondReconnectedMessage).data),
			reconnectedEvent,
		)
	} finally {
		await Promise.all([...sockets].map(closeSocket))
		await server.app.stop()
	}
})
