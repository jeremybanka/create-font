export const CREATE_ART_REALTIME_VERSION = 1 as const
export const CREATE_ART_REALTIME_PATH = `/api/collaboration/socket.io` as const

export type CollaborationRole = `owner` | `editor` | `viewer`
export type AdmissionDecision = `pending` | `approved` | `rejected`

export interface CollaborationIdentity {
	readonly deviceId: string
	readonly email: string
	readonly name: string
	readonly publicKey: string
}

export interface SignedIdentityClaim {
	readonly audience: string
	readonly identity: CollaborationIdentity
	readonly issuedAt: number
	readonly nonce: string
	readonly signature: string
}

export interface HostInvitation {
	readonly address: string
	readonly certificateFingerprint: string
	readonly expiresAt: number
	readonly invitationToken: string
	readonly issuedAt: number
	readonly protocol: typeof CREATE_ART_REALTIME_VERSION
}

export interface AdmissionRequest {
	readonly id: string
	readonly identity: CollaborationIdentity
	readonly requestedAt: number
}

export interface CollaborationParticipant {
	readonly connected: boolean
	readonly connectedAt: number | null
	readonly identity: CollaborationIdentity
	readonly role: CollaborationRole
}

export interface CollaborationSessionStatus {
	readonly admission: AdmissionDecision
	readonly participants: readonly CollaborationParticipant[]
	readonly requestId?: string
	readonly role?: CollaborationRole
}

export interface ActionRequest<Command> {
	readonly baseEpoch: number
	readonly command: Command
	readonly operationId: string
}

export interface ConfirmedAction<Command> {
	readonly authorDeviceId: string
	readonly command: Command
	readonly epoch: number
	readonly operationId: string
}

export interface ActionSnapshot<Source, Command> {
	readonly actions: readonly ConfirmedAction<Command>[]
	readonly base: Source
	readonly epoch: number
}

export interface ActionRejection<Source, Command> {
	readonly code: `forbidden` | `invalid` | `stale`
	readonly message: string
	readonly operationId: string
	readonly snapshot: ActionSnapshot<Source, Command>
}

export interface CollaborationPresence {
	readonly context: Readonly<Record<string, string | null>>
	readonly cursor: Readonly<{ x: number; y: number }> | null
	readonly deviceId: string
	readonly gesture: string | null
	readonly selection: readonly string[]
}

export interface CollaborationClientEvents<Source, Command> {
	"collaboration:action": (
		request: ActionRequest<Command>,
		acknowledge: (accepted: boolean) => void,
	) => void
	"collaboration:presence": (presence: CollaborationPresence) => void
	"collaboration:snapshot": (
		acknowledge: (snapshot: ActionSnapshot<Source, Command>) => void,
	) => void
}

export interface CollaborationServerEvents<Source, Command> {
	"collaboration:confirmed": (action: ConfirmedAction<Command>) => void
	"collaboration:participants": (
		participants: readonly CollaborationParticipant[],
	) => void
	"collaboration:presence": (presence: CollaborationPresence) => void
	"collaboration:rejected": (
		rejection: ActionRejection<Source, Command>,
	) => void
	"collaboration:reset": (snapshot: ActionSnapshot<Source, Command>) => void
}
