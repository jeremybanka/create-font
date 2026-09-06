import { createHash, randomBytes, verify } from "node:crypto"

import type {
	AdmissionRequest,
	CollaborationParticipant,
	CollaborationRole,
	CollaborationIdentity,
	HostInvitation,
	SignedIdentityClaim,
} from "./contracts.ts"

export {
	readOrCreateDeviceIdentity,
	rotateDeviceIdentity,
	signIdentityClaim,
	type DeviceIdentity,
} from "./device-identity.ts"
export { type CredentialStore } from "./credential-store.ts"

function claimPayload(claim: Omit<SignedIdentityClaim, `signature`>): string {
	return JSON.stringify({
		audience: claim.audience,
		identity: claim.identity,
		issuedAt: claim.issuedAt,
		nonce: claim.nonce,
	})
}

export function verifyIdentityClaim(
	claim: SignedIdentityClaim,
	options: { readonly now?: number; readonly ttlMs?: number } = {},
): boolean {
	const now = options.now ?? Date.now()
	const ttlMs = options.ttlMs ?? 60_000
	if (
		typeof claim !== `object` ||
		claim === null ||
		typeof claim.audience !== `string` ||
		typeof claim.nonce !== `string` ||
		typeof claim.signature !== `string` ||
		typeof claim.identity !== `object` ||
		claim.identity === null ||
		typeof claim.identity.deviceId !== `string` ||
		typeof claim.identity.email !== `string` ||
		typeof claim.identity.name !== `string` ||
		typeof claim.identity.publicKey !== `string` ||
		!Number.isSafeInteger(claim.issuedAt) ||
		Math.abs(now - claim.issuedAt) > ttlMs ||
		claim.audience.length < 32 ||
		claim.audience.length > 256 ||
		claim.nonce.length === 0 ||
		claim.nonce.length > 256 ||
		claim.identity.name.length === 0 ||
		claim.identity.name.length > 256 ||
		claim.identity.email.length === 0 ||
		claim.identity.email.length > 320 ||
		claim.identity.publicKey.length === 0 ||
		claim.identity.publicKey.length > 4_096 ||
		claim.signature.length === 0 ||
		claim.signature.length > 512 ||
		claim.identity.deviceId !==
			createHash(`sha256`)
				.update(claim.identity.publicKey)
				.digest(`hex`)
				.slice(0, 24)
	) {
		return false
	}
	const { signature, ...unsigned } = claim
	try {
		return verify(
			null,
			Buffer.from(claimPayload(unsigned)),
			claim.identity.publicKey,
			Buffer.from(signature, `base64url`),
		)
	} catch {
		return false
	}
}

export function encodeInvitation(invitation: HostInvitation): string {
	return Buffer.from(JSON.stringify(invitation)).toString(`base64url`)
}

export function decodeInvitation(value: string): HostInvitation {
	let invitation: HostInvitation
	try {
		invitation = JSON.parse(
			Buffer.from(value, `base64url`).toString(`utf8`),
		) as HostInvitation
	} catch {
		throw new TypeError(`Invalid create-* collaboration invitation.`)
	}
	let address: URL
	try {
		address = new URL(invitation.address)
	} catch {
		throw new TypeError(`Invalid create-* collaboration invitation.`)
	}
	if (
		invitation.protocol !== 1 ||
		!Number.isSafeInteger(invitation.issuedAt) ||
		!Number.isSafeInteger(invitation.expiresAt) ||
		invitation.expiresAt <= invitation.issuedAt ||
		invitation.expiresAt <= Date.now() ||
		invitation.expiresAt - invitation.issuedAt > 24 * 60 * 60 * 1_000 ||
		address.protocol !== `https:` ||
		address.username !== `` ||
		address.password !== `` ||
		address.hash !== `` ||
		address.pathname !== `/` ||
		address.search !== `` ||
		typeof invitation.certificateFingerprint !== `string` ||
		!/^(?:[\da-f]{2}:?){32}$/i.test(invitation.certificateFingerprint) ||
		typeof invitation.invitationToken !== `string` ||
		invitation.invitationToken.length < 32 ||
		invitation.invitationToken.length > 256
	) {
		throw new TypeError(`Invalid create-* collaboration invitation.`)
	}
	return invitation
}

interface PendingAdmission extends AdmissionRequest {
	readonly pollToken: string
	decision: `approved` | `pending` | `rejected`
	sessionToken?: string
}

interface ActiveSession {
	connections: number
	connectedAt: number | null
	readonly expiresAt: number | null
	readonly identity: CollaborationIdentity
	readonly role: CollaborationRole
	readonly token: string
}

const secret = (): string => randomBytes(32).toString(`base64url`)
const GUEST_SESSION_TTL_MS = 12 * 60 * 60 * 1_000
const ADMISSION_RATE_WINDOW_MS = 60_000
const ADMISSION_RATE_LIMIT = 32

/** Process-local admission authority. Restarting the host invalidates every guest. */
export function createAdmissionAuthority(options: {
	readonly invitationExpiresAt?: number
	readonly invitationToken?: string
	readonly owner: CollaborationIdentity
}) {
	const invitationToken = options.invitationToken ?? secret()
	const invitationExpiresAt =
		options.invitationExpiresAt ?? Date.now() + GUEST_SESSION_TTL_MS
	const ownerToken = secret()
	const pending = new Map<string, PendingAdmission>()
	const sessions = new Map<string, ActiveSession>()
	const usedClaims = new Set<string>()
	const admissionTimes: number[] = []
	sessions.set(ownerToken, {
		connections: 0,
		connectedAt: null,
		expiresAt: null,
		identity: options.owner,
		role: `owner`,
		token: ownerToken,
	})
	const purgeExpiredSessions = (now = Date.now()): void => {
		for (const [token, session] of sessions) {
			if (session.expiresAt !== null && session.expiresAt <= now) {
				sessions.delete(token)
			}
		}
	}

	const participants = (): readonly CollaborationParticipant[] => {
		purgeExpiredSessions()
		return Object.freeze(
			[...sessions.values()].map((session) => ({
				connected: session.connections > 0,
				connectedAt: session.connectedAt,
				identity: session.identity,
				role: session.role,
			})),
		)
	}

	return {
		invitationToken,
		ownerToken,
		approve(requestId: string, role: Exclude<CollaborationRole, `owner`>) {
			const request = pending.get(requestId)
			if (request === undefined || request.decision !== `pending`) return null
			const token = secret()
			sessions.set(token, {
				connections: 0,
				connectedAt: null,
				expiresAt: Math.min(
					invitationExpiresAt,
					Date.now() + GUEST_SESSION_TTL_MS,
				),
				identity: request.identity,
				role,
				token,
			})
			request.decision = `approved`
			request.sessionToken = token
			return token
		},
		authenticate(token: string | undefined): ActiveSession | null {
			if (token === undefined) return null
			purgeExpiredSessions()
			const session = sessions.get(token)
			return session ?? null
		},
		connectionClosed(token: string): void {
			const session = sessions.get(token)
			if (session !== undefined)
				session.connections = Math.max(0, session.connections - 1)
		},
		connectionOpened(token: string): void {
			purgeExpiredSessions()
			const session = sessions.get(token)
			if (session !== undefined) {
				if (session.connections === 0) session.connectedAt = Date.now()
				session.connections += 1
			}
		},
		expire(token: string): boolean {
			const session = sessions.get(token)
			if (session === undefined || session.role === `owner`) return false
			return sessions.delete(token)
		},
		participants,
		pending(): readonly AdmissionRequest[] {
			return Object.freeze(
				[...pending.values()]
					.filter((request) => request.decision === `pending`)
					.map(({ id, identity, requestedAt }) => ({
						id,
						identity,
						requestedAt,
					})),
			)
		},
		poll(requestId: string, pollToken: string) {
			const request = pending.get(requestId)
			if (request === undefined || request.pollToken !== pollToken) return null
			return {
				decision: request.decision,
				...(request.sessionToken === undefined
					? {}
					: { sessionToken: request.sessionToken }),
			}
		},
		reject(requestId: string): boolean {
			const request = pending.get(requestId)
			if (request === undefined) return false
			request.decision = `rejected`
			return true
		},
		request(claim: SignedIdentityClaim, token: string) {
			const now = Date.now()
			while (
				admissionTimes[0] !== undefined &&
				admissionTimes[0] <= now - ADMISSION_RATE_WINDOW_MS
			) {
				admissionTimes.shift()
			}
			if (now >= invitationExpiresAt || token !== invitationToken) {
				return null
			}
			if (admissionTimes.length >= ADMISSION_RATE_LIMIT) return null
			admissionTimes.push(now)
			if (
				claim.audience !== invitationToken ||
				usedClaims.has(claim.signature) ||
				!verifyIdentityClaim(claim, { now })
			) {
				return null
			}
			usedClaims.add(claim.signature)
			const existing = [...pending.values()].find(
				(request) => request.identity.deviceId === claim.identity.deviceId,
			)
			if (existing !== undefined) {
				return { id: existing.id, pollToken: existing.pollToken }
			}
			const id = secret()
			const pollToken = secret()
			pending.set(id, {
				decision: `pending`,
				id,
				identity: claim.identity,
				pollToken,
				requestedAt: Date.now(),
			})
			return { id, pollToken }
		},
		revoke(deviceId: string): boolean {
			for (const [requestId, request] of pending) {
				if (request.identity.deviceId === deviceId) pending.delete(requestId)
			}
			for (const [token, session] of sessions) {
				if (
					session.role !== `owner` &&
					session.identity.deviceId === deviceId
				) {
					sessions.delete(token)
					return true
				}
			}
			return false
		},
	}
}
