import type {
	ActionSnapshot,
	CollaborationIdentity,
	CollaborationParticipant,
	CollaborationPresence,
	ConfirmedAction,
} from "./contracts.ts"

/** Runtime projection: TypeScript structural types do not remove private fields. */
export function publicIdentity(
	identity: CollaborationIdentity,
): CollaborationIdentity {
	const { deviceId, email, name, publicKey } = identity
	if (
		[deviceId, email, name, publicKey].some(
			(value) => typeof value !== `string`,
		)
	) {
		throw new TypeError(`Invalid public collaboration identity.`)
	}
	return Object.freeze({ deviceId, email, name, publicKey })
}

export function publicParticipant(
	participant: CollaborationParticipant,
): CollaborationParticipant {
	return {
		connected: participant.connected === true,
		connectedAt:
			participant.connectedAt === null ||
			typeof participant.connectedAt === `number`
				? participant.connectedAt
				: null,
		identity: publicIdentity(participant.identity),
		role:
			participant.role === `owner` || participant.role === `editor`
				? participant.role
				: `viewer`,
	}
}

/** Source and Command are public application data; their schemas belong to the app. */
export function publicAction<Command>(
	action: ConfirmedAction<Command>,
): ConfirmedAction<Command> {
	if (
		typeof action.authorDeviceId !== `string` ||
		typeof action.operationId !== `string` ||
		!Number.isSafeInteger(action.epoch)
	) {
		throw new TypeError(`Invalid public collaboration action.`)
	}
	return {
		authorDeviceId: action.authorDeviceId,
		command: action.command,
		epoch: action.epoch,
		operationId: action.operationId,
	}
}

export function publicSnapshot<Source, Command>(
	snapshot: ActionSnapshot<Source, Command>,
): ActionSnapshot<Source, Command> {
	if (
		!Number.isSafeInteger(snapshot.epoch) ||
		!Array.isArray(snapshot.actions)
	) {
		throw new TypeError(`Invalid public collaboration snapshot.`)
	}
	return {
		actions: snapshot.actions.map(publicAction),
		base: snapshot.base,
		epoch: snapshot.epoch,
	}
}

/** Only explicitly registered application context fields may accompany presence. */
export function publicPresence(
	presence: CollaborationPresence,
	contextKeys: readonly string[],
): CollaborationPresence {
	const rectangle = (
		value: NonNullable<CollaborationPresence[`selectionBox`]>,
	) => ({
		minX: value.minX,
		minY: value.minY,
		maxX: value.maxX,
		maxY: value.maxY,
	})
	return {
		context: Object.fromEntries(
			contextKeys.flatMap((key) => {
				const value = presence.context[key]
				return typeof value === `string` || value === null ? [[key, value]] : []
			}),
		),
		cursor:
			presence.cursor === null
				? null
				: { x: presence.cursor.x, y: presence.cursor.y },
		deviceId: presence.deviceId,
		gesture: presence.gesture,
		selection: [...presence.selection],
		...(presence.selectionBox === undefined
			? {}
			: {
					selectionBox:
						presence.selectionBox === null
							? null
							: rectangle(presence.selectionBox),
				}),
		...(presence.ui === undefined
			? {}
			: {
					ui:
						presence.ui === null
							? null
							: {
									columns: presence.ui.columns.map(rectangle),
									cursor:
										presence.ui.cursor === null
											? null
											: {
													column: presence.ui.cursor.column,
													x: presence.ui.cursor.x,
													y: presence.ui.cursor.y,
												},
								},
				}),
	}
}
