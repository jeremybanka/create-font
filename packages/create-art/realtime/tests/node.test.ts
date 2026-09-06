import { describe, expect, it, vi } from "vitest"
import { memoryCredentialStore } from "./memory-credential-store.ts"

import {
	createAdmissionAuthority,
	decodeInvitation,
	encodeInvitation,
	readOrCreateDeviceIdentity,
	signIdentityClaim,
	verifyIdentityClaim,
} from "../src/node.ts"

describe(`LAN identity and admission`, () => {
	it(`persists a device key and proves the Git-facing identity`, async () => {
		const credentialStore = memoryCredentialStore()
		const first = await readOrCreateDeviceIdentity({
			email: `ada@example.test`,
			name: `Ada`,
			credentialStore,
		})
		const second = await readOrCreateDeviceIdentity({
			email: `ada@example.test`,
			name: `Ada`,
			credentialStore,
		})
		expect(second.publicIdentity.deviceId).toBe(first.publicIdentity.deviceId)
		expect(
			verifyIdentityClaim(
				signIdentityClaim(first, {
					audience: `a`.repeat(32),
					nonce: `host-nonce`,
				}),
			),
		).toBe(true)
		const claim = signIdentityClaim(first, {
			audience: `a`.repeat(32),
			nonce: `host-nonce`,
		})
		expect(
			verifyIdentityClaim({
				...claim,
				identity: { ...claim.identity, deviceId: `forged-device` },
			}),
		).toBe(false)
		expect(first.publicIdentity).toMatchObject({
			deviceId: first.publicIdentity.deviceId,
			email: `ada@example.test`,
			name: `Ada`,
		})
		expect(Object.keys(first)).toEqual([`publicIdentity`, `signClaim`])
		expect(JSON.stringify(first)).not.toContain(`PRIVATE KEY`)
	})

	it(`requires host approval each process and revokes active sessions`, async () => {
		const identity = await readOrCreateDeviceIdentity({
			email: `guest@example.test`,
			name: `Guest`,
			credentialStore: memoryCredentialStore(),
		})
		const host = createAdmissionAuthority({ owner: identity.publicIdentity })
		const claim = signIdentityClaim(identity, {
			audience: host.invitationToken,
			nonce: `invitation`,
		})
		const request = host.request(claim, host.invitationToken)
		expect(request).not.toBeNull()
		expect(host.request(claim, host.invitationToken)).toBeNull()
		const otherHost = createAdmissionAuthority({
			owner: identity.publicIdentity,
		})
		expect(otherHost.request(claim, otherHost.invitationToken)).toBeNull()
		if (request === null) return
		expect(host.poll(request.id, request.pollToken)).toEqual({
			decision: `pending`,
		})
		const token = host.approve(request.id, `editor`)
		expect(token).not.toBeNull()
		expect(host.authenticate(token ?? undefined)?.role).toBe(`editor`)
		expect(host.revoke(identity.publicIdentity.deviceId)).toBe(true)
		expect(host.authenticate(token ?? undefined)).toBeNull()

		const limitedHost = createAdmissionAuthority({
			owner: identity.publicIdentity,
		})
		for (let index = 0; index < 32; index += 1) {
			expect(
				limitedHost.request(
					signIdentityClaim(identity, {
						audience: limitedHost.invitationToken,
						nonce: `rate-${index}`,
					}),
					limitedHost.invitationToken,
				),
			).not.toBeNull()
		}
		expect(
			limitedHost.request(
				signIdentityClaim(identity, {
					audience: limitedHost.invitationToken,
					nonce: `rate-limited`,
				}),
				limitedHost.invitationToken,
			),
		).toBeNull()
	})

	it(`round-trips a pinned invitation`, () => {
		const invitation = {
			address: `https://192.168.1.5:3000`,
			certificateFingerprint: `AA:`.repeat(31) + `AA`,
			expiresAt: Date.now() + 60_000,
			invitationToken: `secret`.repeat(8),
			issuedAt: Date.now(),
			protocol: 1 as const,
		}
		expect(decodeInvitation(encodeInvitation(invitation))).toEqual(invitation)
		expect(() =>
			decodeInvitation(
				encodeInvitation({ ...invitation, address: `http://192.168.1.5` }),
			),
		).toThrow(`Invalid`)
		expect(() =>
			decodeInvitation(
				encodeInvitation({
					...invitation,
					expiresAt: Date.now() - 1,
					issuedAt: Date.now() - 2,
				}),
			),
		).toThrow(`Invalid`)
	})

	it(`expires guest credentials without expiring the owner`, async () => {
		const identity = await readOrCreateDeviceIdentity({
			email: `guest@example.test`,
			name: `Guest`,
			credentialStore: memoryCredentialStore(),
		})
		const host = createAdmissionAuthority({ owner: identity.publicIdentity })
		const request = host.request(
			signIdentityClaim(identity, {
				audience: host.invitationToken,
				nonce: `expiry`,
			}),
			host.invitationToken,
		)
		if (request === null) throw new Error(`Expected an admission request.`)
		const token = host.approve(request.id, `editor`)
		if (token === null) throw new Error(`Expected an admitted session.`)
		const now = Date.now()
		const expiredHost = createAdmissionAuthority({
			invitationExpiresAt: now - 1,
			owner: identity.publicIdentity,
		})
		expect(
			expiredHost.request(
				signIdentityClaim(identity, {
					audience: expiredHost.invitationToken,
					nonce: `expired-invitation`,
				}),
				expiredHost.invitationToken,
			),
		).toBeNull()
		const clock = vi
			.spyOn(Date, `now`)
			.mockReturnValue(now + 12 * 60 * 60 * 1_000 + 1)
		try {
			expect(host.authenticate(token)).toBeNull()
			expect(host.authenticate(host.ownerToken)?.role).toBe(`owner`)
			expect(host.participants().some(({ role }) => role === `editor`)).toBe(
				false,
			)
		} finally {
			clock.mockRestore()
		}
	})
})
