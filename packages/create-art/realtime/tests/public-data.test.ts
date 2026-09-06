import { createHash, generateKeyPairSync, sign } from "node:crypto"

import { describe, expect, it } from "vitest"

import { createAdmissionAuthority, encodeInvitation } from "../src/node.ts"
import { publicIdentity, publicSnapshot } from "../src/public-data.ts"

const marker = `synthetic-private-credential-must-not-travel`
const identity = {
	deviceId: `owner`,
	email: `owner@example.test`,
	name: `Owner`,
	publicKey: `public`,
}

describe(`public protocol boundaries`, () => {
	it(`encodes only invitation exchange fields`, () => {
		const invitation = {
			address: `https://friend.local:3000`,
			certificateFingerprint: `public`,
			expiresAt: Date.now() + 60_000,
			invitationToken: `intended-recipient-token`,
			issuedAt: Date.now(),
			protocol: 1 as const,
			privateKey: marker,
		}
		const decoded = Buffer.from(
			encodeInvitation(invitation),
			`base64url`,
		).toString(`utf8`)
		expect(decoded).not.toContain(marker)
		expect(JSON.parse(decoded)).toHaveProperty(
			`invitationToken`,
			invitation.invitationToken,
		)
		expect(() =>
			encodeInvitation({
				...invitation,
				address: { privateKey: marker },
			} as never),
		).toThrow(`Invalid create-* collaboration invitation.`)
	})
	it(`detaches admitted identities from credentials and mutable caller objects`, () => {
		const owner = {
			...identity,
			privateKey: marker,
			credentials: { nested: marker },
		}
		const host = createAdmissionAuthority({ owner })
		owner.name = `Changed after admission`
		const publicOwner = host.participants()[0].identity
		expect(publicOwner).toEqual(identity)
		expect(publicOwner).not.toBe(owner)
		expect(Reflect.set(publicOwner, `privateKey`, marker)).toBe(false)
		expect(host.authenticate(host.ownerToken)).not.toHaveProperty(`token`)
		expect(JSON.stringify(host.authenticate(host.ownerToken))).not.toContain(
			marker,
		)
		expect(JSON.stringify(host.participants())).not.toContain(marker)
	})

	it(`keeps signed guest extras out of pending requests, sessions, and participants`, () => {
		const host = createAdmissionAuthority({ owner: identity })
		const keys = generateKeyPairSync(`ed25519`)
		const publicKey = keys.publicKey
			.export({ format: `pem`, type: `spki` })
			.toString()
		const guest = {
			...identity,
			deviceId: createHash(`sha256`)
				.update(publicKey)
				.digest(`hex`)
				.slice(0, 24),
			publicKey,
		}
		const unsigned = {
			audience: host.invitationToken,
			identity: guest,
			issuedAt: Date.now(),
			nonce: `guest`,
		}
		const claim = {
			...unsigned,
			identity: {
				...guest,
				privateKey: marker,
				nested: { credentials: marker },
			},
			signature: sign(
				null,
				Buffer.from(JSON.stringify(unsigned)),
				keys.privateKey,
			).toString(`base64url`),
		}
		const request = host.request(claim, host.invitationToken)
		expect(request).not.toBeNull()
		if (request === null) throw new Error(`Expected admission`)
		claim.identity.name = `Changed after request`
		expect(host.pending()[0].identity).toEqual(guest)
		expect(host.approve(request.id, { privateKey: marker } as never)).toBeNull()
		const token = host.approve(request.id, `editor`)
		expect(token).not.toBeNull()
		expect(host.poll(request.id, request.pollToken)).toEqual({
			decision: `approved`,
			sessionToken: token,
		})
		expect(
			JSON.stringify([
				host.pending(),
				host.participants(),
				host.authenticate(token ?? undefined),
			]),
		).not.toContain(marker)
	})

	it(`rejects object-valued identity fields and strips private snapshot envelope fields`, () => {
		expect(() =>
			publicIdentity({ ...identity, name: { privateKey: marker } } as never),
		).toThrow(`Invalid public`)
		const snapshot = publicSnapshot({
			base: { text: `Public user-authored text` },
			epoch: 1,
			privateKey: marker,
			actions: [
				{
					authorDeviceId: `owner`,
					command: { delta: 1 },
					epoch: 1,
					operationId: `one`,
					credentials: { key: marker },
				},
			],
		} as never)
		expect(JSON.stringify(snapshot)).not.toContain(marker)
		expect(snapshot).toMatchObject({
			epoch: 1,
			base: { text: `Public user-authored text` },
		})
	})
})
