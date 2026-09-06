import type { SocketGuard } from "atom.io/realtime"
import { guardSocket } from "atom.io/realtime"
import {
	publicAction,
	publicParticipant,
	publicPresence,
	publicSnapshot,
} from "./public-data.ts"

import type {
	ActionRejection,
	ActionRequest,
	ActionSnapshot,
	CollaborationClientEvents,
	CollaborationParticipant,
	CollaborationPresence,
	CollaborationRole,
	CollaborationServerEvents,
	ConfirmedAction,
} from "./contracts.ts"

export interface CollaborationServerSocket<Source, Command> {
	broadcast: {
		emit<Event extends keyof CollaborationServerEvents<Source, Command>>(
			event: Event,
			...parameters: Parameters<
				CollaborationServerEvents<Source, Command>[Event]
			>
		): void
	}
	emit<Event extends keyof CollaborationServerEvents<Source, Command>>(
		event: Event,
		...parameters: Parameters<CollaborationServerEvents<Source, Command>[Event]>
	): void
	id: string
	on(event: string, listener: (...parameters: any[]) => void): void
	onAny(listener: (event: string, ...parameters: any[]) => void): void
	onAnyOutgoing(listener: (event: string, ...parameters: any[]) => void): void
	off(event: string, listener?: (...parameters: any[]) => void): void
	offAny(listener?: (event: string, ...parameters: any[]) => void): void
}

type StandardValidator = SocketGuard<any>[string]

export class CollaborationActionError extends Error {
	readonly code: `invalid` | `stale`

	constructor(code: `invalid` | `stale`, message: string) {
		super(message)
		this.code = code
		this.name = `CollaborationActionError`
	}
}

function validator<Parameters extends readonly unknown[]>(
	validate: (parameters: unknown) => parameters is Parameters,
): StandardValidator {
	return {
		"~standard": {
			validate: (value: unknown) =>
				validate(value)
					? { value }
					: { issues: [{ message: `Invalid realtime event payload.` }] },
			vendor: `create-art`,
			version: 1,
		},
	} as StandardValidator
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

export function provideAuthoritativeActions<Source, Command>(options: {
	readonly apply: (
		command: Command,
		context: Readonly<{
			authorDeviceId: string
			baseEpoch: number
			operationId: string
		}>,
	) => Promise<boolean | void> | boolean | void
	readonly deviceId: string
	readonly participants: () => readonly CollaborationParticipant[]
	readonly presenceContextKeys?: readonly string[]
	/** Constructs the application's public command payload after validation. */
	readonly projectCommand?: (command: Command) => Command
	readonly role: CollaborationRole
	readonly snapshot: () => ActionSnapshot<Source, Command>
	readonly socket: CollaborationServerSocket<Source, Command>
	readonly validateCommand: (command: unknown) => command is Command
}) {
	const seen = new Set<string>()
	let queue = Promise.resolve()
	const snapshot = () => publicSnapshot(options.snapshot())
	const guards = {
		"collaboration:action": validator(
			(
				parameters,
			): parameters is readonly [
				ActionRequest<Command>,
				(accepted: boolean) => void,
			] => {
				if (!Array.isArray(parameters) || parameters.length !== 2) return false
				const [request, acknowledge] = parameters
				return (
					isRecord(request) &&
					Number.isSafeInteger(request.baseEpoch) &&
					request.baseEpoch >= 0 &&
					typeof request.operationId === `string` &&
					request.operationId.length > 0 &&
					request.operationId.length <= 256 &&
					options.validateCommand(request.command) &&
					typeof acknowledge === `function`
				)
			},
		),
		"collaboration:presence": validator(
			(parameters): parameters is readonly [CollaborationPresence] => {
				if (
					!Array.isArray(parameters) ||
					parameters.length !== 1 ||
					!isRecord(parameters[0])
				) {
					return false
				}
				const presence = parameters[0]
				const cursor = presence.cursor
				const context = presence.context
				const selectionBox = presence.selectionBox
				const ui = presence.ui
				const normalizedNumber = (value: unknown): value is number =>
					typeof value === `number` &&
					Number.isFinite(value) &&
					value >= 0 &&
					value <= 1
				return (
					typeof presence.deviceId === `string` &&
					presence.deviceId.length <= 128 &&
					isRecord(context) &&
					Object.entries(context).length <= 32 &&
					Object.entries(context).every(
						([key, value]) =>
							key.length > 0 &&
							key.length <= 128 &&
							(value === null ||
								(typeof value === `string` && value.length <= 512)),
					) &&
					(presence.gesture === null || typeof presence.gesture === `string`) &&
					(cursor === null ||
						(isRecord(cursor) &&
							typeof cursor.x === `number` &&
							Number.isFinite(cursor.x) &&
							typeof cursor.y === `number` &&
							Number.isFinite(cursor.y))) &&
					(selectionBox === undefined ||
						selectionBox === null ||
						(isRecord(selectionBox) &&
							typeof selectionBox.minX === `number` &&
							Number.isFinite(selectionBox.minX) &&
							typeof selectionBox.minY === `number` &&
							Number.isFinite(selectionBox.minY) &&
							typeof selectionBox.maxX === `number` &&
							Number.isFinite(selectionBox.maxX) &&
							typeof selectionBox.maxY === `number` &&
							Number.isFinite(selectionBox.maxY) &&
							selectionBox.minX <= selectionBox.maxX &&
							selectionBox.minY <= selectionBox.maxY)) &&
					(ui === undefined ||
						ui === null ||
						(isRecord(ui) &&
							Array.isArray(ui.columns) &&
							ui.columns.length <= 8 &&
							ui.columns.every(
								(column) =>
									isRecord(column) &&
									normalizedNumber(column.minX) &&
									normalizedNumber(column.minY) &&
									normalizedNumber(column.maxX) &&
									normalizedNumber(column.maxY) &&
									column.minX <= column.maxX &&
									column.minY <= column.maxY,
							) &&
							(ui.cursor === null ||
								(isRecord(ui.cursor) &&
									Number.isSafeInteger(ui.cursor.column) &&
									ui.cursor.column >= 0 &&
									ui.cursor.column < ui.columns.length &&
									normalizedNumber(ui.cursor.x) &&
									normalizedNumber(ui.cursor.y))))) &&
					Array.isArray(presence.selection) &&
					presence.selection.length <= 10_000 &&
					presence.selection.every((item) => typeof item === `string`)
				)
			},
		),
		"collaboration:snapshot": validator(
			(
				parameters,
			): parameters is readonly [
				(snapshot: ActionSnapshot<Source, Command>) => void,
			] =>
				Array.isArray(parameters) &&
				parameters.length === 1 &&
				typeof parameters[0] === `function`,
		),
	} satisfies SocketGuard<CollaborationClientEvents<Source, Command>>
	const socket = guardSocket<CollaborationClientEvents<Source, Command>>(
		options.socket,
		guards,
	)

	socket.on(`collaboration:snapshot`, (acknowledge) => {
		acknowledge(snapshot())
	})
	socket.on(`collaboration:presence`, (presence) => {
		if (presence.deviceId !== options.deviceId) return
		options.socket.broadcast.emit(
			`collaboration:presence`,
			publicPresence(presence, options.presenceContextKeys ?? []),
		)
	})
	socket.on(`collaboration:action`, (request, acknowledge) => {
		if (options.role === `viewer`) {
			const rejection: ActionRejection<Source, Command> = {
				code: `forbidden`,
				message: `Viewer sessions cannot edit this workspace.`,
				operationId: request.operationId,
				snapshot: snapshot(),
			}
			options.socket.emit(`collaboration:rejected`, rejection)
			acknowledge(false)
			return
		}
		if (seen.has(request.operationId)) {
			acknowledge(true)
			return
		}
		queue = queue.then(async () => {
			const before = snapshot()
			if (
				before.actions.some(
					(action) => action.operationId === request.operationId,
				)
			) {
				seen.add(request.operationId)
				acknowledge(true)
				return
			}
			if (request.baseEpoch !== before.epoch) {
				options.socket.emit(`collaboration:rejected`, {
					code: `stale`,
					message: `The workspace advanced before this edit arrived.`,
					operationId: request.operationId,
					snapshot: before,
				})
				acknowledge(false)
				return
			}
			try {
				const command =
					options.projectCommand?.(request.command) ?? request.command
				const applied = await options.apply(command, {
					authorDeviceId: options.deviceId,
					baseEpoch: request.baseEpoch,
					operationId: request.operationId,
				})
				if (applied === false) {
					seen.add(request.operationId)
					acknowledge(true)
					return
				}
				seen.add(request.operationId)
				const confirmed: ConfirmedAction<Command> = publicAction({
					authorDeviceId: options.deviceId,
					command,
					epoch: snapshot().epoch,
					operationId: request.operationId,
				})
				options.socket.emit(`collaboration:confirmed`, confirmed)
				options.socket.broadcast.emit(`collaboration:confirmed`, confirmed)
				acknowledge(true)
			} catch (error) {
				options.socket.emit(`collaboration:rejected`, {
					code:
						error instanceof CollaborationActionError && error.code === `stale`
							? `stale`
							: `invalid`,
					message:
						error instanceof CollaborationActionError && error.code === `stale`
							? `The workspace advanced before this edit could be saved.`
							: `The edit could not be saved.`,
					operationId: request.operationId,
					snapshot: snapshot(),
				})
				acknowledge(false)
			}
		})
	})
	options.socket.emit(
		`collaboration:participants`,
		options.participants().map(publicParticipant),
	)

	// Socket.IO releases every listener with the socket. `guardSocket` owns the
	// validated wrapper callbacks, so there is intentionally nothing to remove
	// independently here.
	return () => undefined
}
