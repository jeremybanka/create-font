import { multiClient } from "atom.io/realtime-testing"
import type { Socket } from "socket.io-client"
import { afterEach, describe, expect, it } from "vitest"

import type {
	ActionRequest,
	ActionSnapshot,
	CollaborationPresence,
	ConfirmedAction,
} from "../src/contracts.ts"
import { createCollaborationClient } from "../src/client.ts"
import { provideAuthoritativeActions } from "../src/server.ts"

type Command = Readonly<{ delta: number }>

function waitForConnection(socket: Socket): Promise<void> {
	if (socket.connected) return Promise.resolve()
	return new Promise((resolve, reject) => {
		const onConnect = () => {
			socket.off(`connect_error`, onError)
			resolve()
		}
		const onError = (error: Error) => {
			socket.off(`connect`, onConnect)
			reject(error)
		}
		socket.once(`connect`, onConnect)
		socket.once(`connect_error`, onError)
	})
}

describe(`authoritative realtime actions`, () => {
	let teardown: (() => Promise<void>) | undefined
	afterEach(async () => teardown?.())

	it(`persists before broadcasting and rejects viewer or stale commands`, async () => {
		let epoch = 0
		let value = 0
		const order: string[] = []
		const actions: ConfirmedAction<Command>[] = []
		const snapshot = (): ActionSnapshot<number, Command> => ({
			actions: [...actions],
			base: 0,
			epoch,
		})
		const test = multiClient({
			clients: {
				EDITOR_A: () => null,
				EDITOR_B: () => null,
				VIEWER: () => null,
			},
			server: ({ socket, userKey }) => {
				const deviceId = userKey.includes(`VIEWER`)
					? `viewer`
					: userKey.includes(`EDITOR_A`)
						? `editor-a`
						: `editor-b`
				return provideAuthoritativeActions<number, Command>({
					async apply(command, context) {
						if (command.delta === 13) throw new Error(`Persistence failed.`)
						order.push(`persist:${context.operationId}`)
						value += command.delta
						epoch += 1
						actions.push({
							authorDeviceId: context.authorDeviceId,
							command,
							epoch,
							operationId: context.operationId,
						})
					},
					deviceId,
					participants: () => [],
					role: deviceId === `viewer` ? `viewer` : `editor`,
					snapshot,
					socket: socket as never,
					validateCommand: (command): command is Command =>
						typeof command === `object` &&
						command !== null &&
						typeof Reflect.get(command, `delta`) === `number`,
				})
			},
		})
		teardown = test.teardown
		const editor = test.clients.EDITOR_A.init()
		const secondEditor = test.clients.EDITOR_B.init()
		const viewer = test.clients.VIEWER.init()
		await Promise.all(
			[editor, secondEditor, viewer].map(({ socket }) =>
				waitForConnection(socket),
			),
		)
		const presence = new Promise<CollaborationPresence>((resolve) => {
			secondEditor.socket.once(`collaboration:presence`, resolve)
		})
		editor.socket.emit(`collaboration:presence`, {
			context: { document: `primary` },
			cursor: { x: 12, y: 24 },
			deviceId: `editor-a`,
			gesture: `pen`,
			selection: [`node:1`],
			selectionBox: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
			ui: {
				columns: [{ minX: 0.02, minY: 0.1, maxX: 0.25, maxY: 0.9 }],
				cursor: { column: 0, x: 0.4, y: 0.6 },
			},
		})
		expect(await presence).toMatchObject({
			context: { document: `primary` },
			deviceId: `editor-a`,
			selectionBox: { minX: 10, minY: 20, maxX: 30, maxY: 40 },
			ui: {
				columns: [{ minX: 0.02, minY: 0.1, maxX: 0.25, maxY: 0.9 }],
				cursor: { column: 0, x: 0.4, y: 0.6 },
			},
		})

		const confirmed = new Promise<ConfirmedAction<Command>>((resolve) => {
			editor.socket.once(`collaboration:confirmed`, (action) => {
				order.push(`broadcast:edit-1`)
				resolve(action)
			})
		})
		const editorAck = new Promise<boolean>((resolve) => {
			editor.socket.emit(
				`collaboration:action`,
				{ baseEpoch: 0, command: { delta: 3 }, operationId: `edit-1` },
				resolve,
			)
		})
		expect(await editorAck).toBe(true)
		expect(await confirmed).toMatchObject({ epoch: 1, operationId: `edit-1` })
		expect(value).toBe(3)
		expect(order).toEqual([`persist:edit-1`, `broadcast:edit-1`])

		const secondConfirmation = new Promise<ConfirmedAction<Command>>(
			(resolve) => editor.socket.once(`collaboration:confirmed`, resolve),
		)
		const secondAck = new Promise<boolean>((resolve) => {
			secondEditor.socket.emit(
				`collaboration:action`,
				{ baseEpoch: 1, command: { delta: 4 }, operationId: `edit-2` },
				resolve,
			)
		})
		expect(await secondAck).toBe(true)
		expect(await secondConfirmation).toMatchObject({
			epoch: 2,
			operationId: `edit-2`,
		})
		expect(value).toBe(7)

		const failure = new Promise<{ code: string }>((resolve) => {
			editor.socket.once(`collaboration:rejected`, resolve)
		})
		const failureAck = new Promise<boolean>((resolve) => {
			editor.socket.emit(
				`collaboration:action`,
				{ baseEpoch: 2, command: { delta: 13 }, operationId: `fail-1` },
				resolve,
			)
		})
		expect(await failureAck).toBe(false)
		expect(await failure).toMatchObject({ code: `invalid` })
		expect(value).toBe(7)
		expect(actions).toHaveLength(2)

		const viewerRejection = new Promise<{ code: string }>((resolve) => {
			viewer.socket.once(`collaboration:rejected`, resolve)
		})
		const viewerAck = new Promise<boolean>((resolve) => {
			viewer.socket.emit(
				`collaboration:action`,
				{ baseEpoch: 2, command: { delta: 9 }, operationId: `view-1` },
				resolve,
			)
		})
		expect(await viewerAck).toBe(false)
		expect(await viewerRejection).toMatchObject({ code: `forbidden` })
		expect(value).toBe(7)

		const staleRejection = new Promise<{ code: string }>((resolve) => {
			editor.socket.once(`collaboration:rejected`, resolve)
		})
		editor.socket.emit(
			`collaboration:action`,
			{ baseEpoch: 0, command: { delta: 1 }, operationId: `stale-1` },
			() => undefined,
		)
		expect(await staleRejection).toMatchObject({ code: `stale` })
		expect(value).toBe(7)
	})

	it(`assigns consecutive base epochs to optimistic commands`, () => {
		const requests: { baseEpoch: number }[] = []
		const client = createCollaborationClient<number, Command>({
			apply: () => undefined,
			deviceId: `editor`,
			load: () => undefined,
			socket: {
				emit(event, ...parameters): void {
					if (event === `collaboration:action`) {
						requests.push(parameters[0] as { baseEpoch: number })
					}
				},
				off: () => undefined,
				on: () => undefined,
			},
		})
		client.replay({ actions: [], base: 0, epoch: 7 })
		client.publish({ delta: 1 })
		client.publish({ delta: 2 })
		expect(requests.map((request) => request.baseEpoch)).toEqual([7, 8])
		client.dispose()
	})

	it(`keeps operation identities distinct across tabs for one device`, () => {
		const operationIds: string[] = []
		const client = () =>
			createCollaborationClient<number, Command>({
				apply: () => undefined,
				deviceId: `shared-device`,
				load: () => undefined,
				socket: {
					emit(event, ...parameters): void {
						if (event === `collaboration:action`) {
							operationIds.push(
								(parameters[0] as ActionRequest<Command>).operationId,
							)
						}
					},
					off: () => undefined,
					on: () => undefined,
				},
			})
		const firstTab = client()
		const secondTab = client()
		firstTab.publish({ delta: 1 })
		secondTab.publish({ delta: 1 })
		expect(new Set(operationIds).size).toBe(2)
		firstTab.dispose()
		secondTab.dispose()
	})

	it(`rebases and retries concurrent optimistic commands after a stale result`, () => {
		const requests: ActionRequest<Command>[] = []
		const handlers = new Map<string, (value: any) => void>()
		const applied: number[] = []
		const loaded: number[] = []
		const client = createCollaborationClient<number, Command>({
			apply: (command) => applied.push(command.delta),
			deviceId: `editor`,
			load: (source) => loaded.push(source),
			socket: {
				emit(event, ...parameters): void {
					if (event === `collaboration:action`) {
						requests.push(parameters[0] as ActionRequest<Command>)
					}
				},
				off: () => undefined,
				on: (event, handler) => handlers.set(event, handler as never),
			},
		})
		client.replay({ actions: [], base: 0, epoch: 0 })
		const first = client.publish({ delta: 1 })
		client.publish({ delta: 2 })
		handlers.get(`collaboration:rejected`)?.({
			code: `stale`,
			message: `advanced`,
			operationId: first,
			snapshot: {
				actions: [
					{
						authorDeviceId: `other`,
						command: { delta: 3 },
						epoch: 1,
						operationId: `remote`,
					},
				],
				base: 10,
				epoch: 1,
			},
		})

		expect(loaded).toEqual([0, 10])
		expect(applied).toEqual([3, 1, 2])
		expect(requests.map(({ baseEpoch }) => baseEpoch)).toEqual([0, 1, 1, 2])
		expect(requests.slice(2).map(({ operationId }) => operationId)).toEqual(
			requests.slice(0, 2).map(({ operationId }) => operationId),
		)
		client.dispose()
	})
})
