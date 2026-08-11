import type {
	ActionRequest,
	ActionSnapshot,
	CollaborationClientEvents,
	CollaborationPresence,
	CollaborationServerEvents,
	ConfirmedAction,
} from "./contracts.ts"

export interface CollaborationClientSocket<Source, Command> {
	emit<Event extends keyof CollaborationClientEvents<Source, Command>>(
		event: Event,
		...parameters: Parameters<CollaborationClientEvents<Source, Command>[Event]>
	): void
	on<Event extends keyof CollaborationServerEvents<Source, Command>>(
		event: Event,
		listener: CollaborationServerEvents<Source, Command>[Event],
	): void
	off<Event extends keyof CollaborationServerEvents<Source, Command>>(
		event: Event,
		listener: CollaborationServerEvents<Source, Command>[Event],
	): void
}

export function createCollaborationClient<Source, Command>(options: {
	readonly apply: (command: Command) => void
	readonly deviceId: string
	readonly load: (source: Source) => void
	readonly socket: CollaborationClientSocket<Source, Command>
}) {
	let epoch = 0
	let operationSequence = 0
	const pending = new Map<string, Command>()
	const clientInstanceId =
		typeof globalThis.crypto?.randomUUID === `function`
			? globalThis.crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`
	const operationId = (): string =>
		`${options.deviceId}:${clientInstanceId}:${operationSequence++}`
	const loadSnapshot = (snapshot: ActionSnapshot<Source, Command>): void => {
		options.load(snapshot.base)
		for (const action of snapshot.actions) options.apply(action.command)
		epoch = snapshot.epoch
	}
	const send = (id: string, command: Command): void => {
		const request: ActionRequest<Command> = {
			baseEpoch: epoch + pending.size,
			command,
			operationId: id,
		}
		pending.set(id, command)
		options.socket.emit(`collaboration:action`, request, () => undefined)
	}
	const rebase = (
		snapshot: ActionSnapshot<Source, Command>,
		operations = [...pending],
	): void => {
		pending.clear()
		loadSnapshot(snapshot)
		for (const [id, command] of operations) {
			try {
				options.apply(command)
				send(id, command)
			} catch {
				// A command may no longer be valid after a remote structural edit. The
				// authoritative snapshot remains installed and the command stays dropped.
			}
		}
	}
	const confirmed = (action: ConfirmedAction<Command>): void => {
		if (action.epoch !== epoch + 1) {
			options.socket.emit(`collaboration:snapshot`, rebase)
			return
		}
		epoch = action.epoch
		if (pending.delete(action.operationId)) return
		options.apply(action.command)
	}
	const rejected = (rejection: {
		readonly code: `forbidden` | `invalid` | `stale`
		readonly operationId: string
		readonly snapshot: ActionSnapshot<Source, Command>
	}): void => {
		const operations = [...pending]
		if (rejection.code !== `stale`) {
			const index = operations.findIndex(([id]) => id === rejection.operationId)
			if (index >= 0) operations.splice(index, 1)
		}
		rebase(rejection.snapshot, operations)
	}
	options.socket.on(`collaboration:confirmed`, confirmed)
	options.socket.on(`collaboration:rejected`, rejected)
	options.socket.on(`collaboration:reset`, rebase)

	return {
		dispose(): void {
			options.socket.off(`collaboration:confirmed`, confirmed)
			options.socket.off(`collaboration:rejected`, rejected)
			options.socket.off(`collaboration:reset`, rebase)
		},
		publish(command: Command): string {
			const id = operationId()
			send(id, command)
			return id
		},
		publishPresence(presence: CollaborationPresence): void {
			options.socket.emit(`collaboration:presence`, presence)
		},
		replay: rebase,
		get epoch(): number {
			return epoch
		},
	}
}
