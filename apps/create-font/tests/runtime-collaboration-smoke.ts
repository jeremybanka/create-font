import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import * as http from "node:http"
import {
	type AddressInfo,
	connect,
	createServer as createNetServer,
} from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CREATE_ART_REALTIME_PATH } from "@create-art/realtime"
import { readOrCreateDeviceIdentity } from "@create-art/realtime/node"

import { startLanHost, startLoopbackGateway } from "../src/lan-gateway.ts"

async function availablePort(): Promise<number> {
	const server = createNetServer()
	await new Promise<void>((resolve, reject) => {
		server.once(`error`, reject)
		server.listen(0, `127.0.0.1`, resolve)
	})
	const port = (server.address() as AddressInfo).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

async function nativeUpgrade(port: number): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const socket = connect(port, `127.0.0.1`)
		socket.once(`connect`, () => {
			socket.write(
				`GET /native HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: SGVsbG9Xb3JsZDEyMzQ1Ng==\r\nOrigin: http://127.0.0.1:${port}\r\n\r\n`,
			)
		})
		socket.once(`data`, (data) => {
			resolve(data.toString(`utf8`))
			socket.destroy()
		})
		socket.once(`error`, reject)
	})
}

const directory = await mkdtemp(join(tmpdir(), `create-font-runtime-collab-`))
const bun = Reflect.get(globalThis, `Bun`) as
	| {
			serve?: (options: {
				fetch(
					request: Request,
					server: { upgrade(request: Request): boolean },
				): Response | undefined
				hostname: string
				port: number
				websocket: {
					message(socket: unknown, message: string | Uint8Array): void
				}
			}) => { port: number; stop(force?: boolean): Promise<void> }
	  }
	| undefined
let backendPort: number
let stopBackend: () => Promise<void>
if (bun?.serve !== undefined) {
	const backend = bun.serve({
		fetch(request, server) {
			if (new URL(request.url).pathname === `/native`) {
				if (server.upgrade(request)) return undefined
				return new Response(`Upgrade failed.`, { status: 400 })
			}
			return new Response(`runtime`)
		},
		hostname: `127.0.0.1`,
		port: 0,
		websocket: { message: () => undefined },
	})
	backendPort = backend.port
	stopBackend = () => backend.stop(true)
} else {
	const backend = http.createServer((_request, response) =>
		response.end(`runtime`),
	)
	backend.on(`upgrade`, (request, socket) => {
		if (request.url !== `/native`) return socket.destroy()
		socket.end(
			`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: PRSDXLCCLyxwwgqQQKzmDJjTD9s=\r\n\r\n`,
		)
	})
	await new Promise<void>((resolve) => backend.listen(0, `127.0.0.1`, resolve))
	backendPort = (backend.address() as AddressInfo).port
	stopBackend = () =>
		new Promise<void>((resolve) => backend.close(() => resolve()))
}
const port = await availablePort()
const identity = await readOrCreateDeviceIdentity({
	email: `runtime@example.test`,
	name: `Runtime Owner`,
	path: join(directory, `identity.json`),
})
const authority = {
	apply: async () => undefined,
	dispose: () => undefined,
	onReset: () => () => undefined,
	snapshot: () => ({ actions: [], base: {}, epoch: 0 }),
} as unknown as Parameters<typeof startLanHost>[0][`authority`]
const host = await startLanHost({
	address: `127.0.0.2`,
	authority,
	identity,
	internalUrl: new URL(`http://127.0.0.1:${backendPort}`),
	port,
})
const gateway = await startLoopbackGateway({
	bearer: host.admissions.ownerToken,
	fingerprint: host.fingerprint,
	port,
	target: new URL(host.invitation.address),
})
try {
	assert.equal(await (await fetch(gateway.url)).text(), `runtime`)
	const pollingUrl = new URL(`${CREATE_ART_REALTIME_PATH}/`, gateway.url)
	pollingUrl.searchParams.set(`EIO`, `4`)
	pollingUrl.searchParams.set(`transport`, `polling`)
	assert.match(await (await fetch(pollingUrl)).text(), /^0\{"sid":/)
	if (bun === undefined) {
		assert.match(await nativeUpgrade(port), /101 Switching Protocols/)
	}
} finally {
	await gateway.stop()
	await host.stop()
	await stopBackend()
	await rm(directory, { force: true, recursive: true })
}

console.log(`collaboration runtime smoke passed`)
