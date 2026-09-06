import * as http from "node:http"
import * as https from "node:https"
import {
	type AddressInfo,
	connect,
	createServer as createNetServer,
} from "node:net"

import {
	CREATE_ART_REALTIME_PATH,
	type CollaborationParticipant,
} from "@create-art/realtime"
import {
	readOrCreateDeviceIdentity,
	signIdentityClaim,
} from "@create-art/realtime/node"
import { io } from "socket.io-client"
import { describe, expect, it } from "vitest"
import { memoryCredentialStore } from "./memory-credential-store.ts"

import {
	requestPinnedJson,
	startLanHost,
	startLoopbackGateway,
} from "../src/lan-gateway.ts"

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

async function requestStatus(
	url: URL,
	headers: http.OutgoingHttpHeaders,
): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const request = http.request(url, { headers }, (response) => {
			response.resume()
			response.once(`end`, () => resolve(response.statusCode ?? 0))
		})
		request.once(`error`, reject)
		request.end()
	})
}

async function insecureHttpsStatus(
	url: URL,
	headers: http.OutgoingHttpHeaders,
): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const request = https.request(
			url,
			{ headers, rejectUnauthorized: false },
			(response) => {
				response.resume()
				response.once(`end`, () => resolve(response.statusCode ?? 0))
			},
		)
		request.once(`error`, reject)
		request.end()
	})
}

async function nativeUpgrade(port: number): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const socket = connect(port, `127.0.0.1`)
		socket.once(`connect`, () => {
			socket.write(
				`GET /native HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: create-font-test\r\nOrigin: http://127.0.0.1:${port}\r\n\r\n`,
			)
		})
		socket.once(`data`, (data) => {
			resolve(data.toString(`utf8`))
			socket.destroy()
		})
		socket.once(`error`, reject)
	})
}

describe(`pinned LAN and loopback gateways`, () => {
	it(`serves static assets while protecting APIs and admitting a guest`, async () => {
		const owner = await readOrCreateDeviceIdentity({
			email: `owner@example.test`,
			name: `Owner`,
			credentialStore: memoryCredentialStore(),
		})
		const guest = await readOrCreateDeviceIdentity({
			email: `guest@example.test`,
			name: `Guest`,
			credentialStore: memoryCredentialStore(),
		})
		const rejectedGuest = await readOrCreateDeviceIdentity({
			email: `rejected@example.test`,
			name: `Rejected Guest`,
			credentialStore: memoryCredentialStore(),
		})
		const backend = http.createServer((request, response) => {
			if (request.url === `/api/stream`) {
				response.writeHead(200, { "content-type": `text/plain` })
				response.write(`first-`)
				queueMicrotask(() => response.end(`second`))
				return
			}
			if (request.url === `/api/health`) {
				response.setHeader(`content-type`, `application/json`)
				response.end(JSON.stringify({ ok: true }))
				return
			}
			response.end(`font app`)
		})
		backend.on(`upgrade`, (request, socket) => {
			if (request.url !== `/native`) return socket.destroy()
			socket.end(
				`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: create-font-test\r\n\r\n`,
			)
		})
		await new Promise<void>((resolve) =>
			backend.listen(0, `127.0.0.1`, resolve),
		)
		const backendPort = (backend.address() as AddressInfo).port
		const sharedPort = await availablePort()
		const authority = {
			apply: async () => undefined,
			dispose: () => undefined,
			onReset: () => () => undefined,
			snapshot: () => ({ actions: [], base: {}, epoch: 0 }),
		} as unknown as Parameters<typeof startLanHost>[0][`authority`]
		const host = await startLanHost({
			address: `127.0.0.2`,
			authority,
			identity: {
				...owner.publicIdentity,
				privateKey: `synthetic-host-private-key`,
				credentials: { nested: `synthetic-host-private-key` },
			} as typeof owner.publicIdentity,
			internalUrl: new URL(`http://127.0.0.1:${backendPort}`),
			port: sharedPort,
		})
		const ownerGateway = await startLoopbackGateway({
			bearer: host.admissions.ownerToken,
			fingerprint: host.fingerprint,
			port: sharedPort,
			target: new URL(host.invitation.address),
		})
		try {
			const malformed = await fetch(
				new URL(`/api/collaboration/admission`, ownerGateway.url),
				{
					method: `POST`,
					headers: { "content-type": `application/json` },
					body: `{"privateKey":"synthetic-request-secret`,
				},
			)
			expect(await malformed.json()).toEqual({
				message: `The collaboration request could not be processed.`,
			})
			expect(await (await fetch(ownerGateway.url)).text()).toBe(`font app`)
			expect(
				await requestStatus(ownerGateway.url, { host: `untrusted.example` }),
			).toBe(421)
			expect(
				(
					await fetch(ownerGateway.url, {
						headers: { origin: `https://untrusted.example` },
					})
				).status,
			).toBe(403)
			expect(
				await (await fetch(new URL(`/api/health`, ownerGateway.url))).json(),
			).toEqual({ ok: true })
			expect(
				await (await fetch(new URL(`/api/stream`, ownerGateway.url))).text(),
			).toBe(`first-second`)
			expect(await nativeUpgrade(sharedPort)).toContain(
				`101 Switching Protocols`,
			)
			const realtimeUrl = new URL(
				`${CREATE_ART_REALTIME_PATH}/?EIO=4&transport=polling`,
				host.invitation.address,
			)
			expect(
				await insecureHttpsStatus(realtimeUrl, {
					host: `untrusted.example`,
				}),
			).toBe(403)
			expect(
				await insecureHttpsStatus(realtimeUrl, {
					origin: `https://untrusted.example`,
				}),
			).toBe(403)
			await expect(
				requestPinnedJson({
					fingerprint: host.fingerprint,
					url: new URL(`/api/health`, host.invitation.address),
				}),
			).rejects.toThrow(`collaboration session`)

			const rejectedRequest = await requestPinnedJson<{
				id: string
				pollToken: string
			}>({
				body: {
					claim: signIdentityClaim(rejectedGuest, {
						audience: host.invitation.invitationToken,
						nonce: `rejected-gateway-test`,
					}),
					invitationToken: host.invitation.invitationToken,
				},
				fingerprint: host.fingerprint,
				method: `POST`,
				url: new URL(`/api/collaboration/admission`, host.invitation.address),
			})
			const rejectedPort = await availablePort()
			const rejectedGateway = await startLoopbackGateway({
				fingerprint: host.fingerprint,
				pending: rejectedRequest,
				port: rejectedPort,
				target: new URL(host.invitation.address),
			})
			try {
				expect(
					(await (
						await fetch(
							new URL(`/api/collaboration/session`, rejectedGateway.url),
						)
					).json()) as { admission: string },
				).toMatchObject({ admission: `pending` })
				expect(
					(await fetch(new URL(`/api/health`, rejectedGateway.url))).status,
				).toBe(401)
				const rejectedDecision = await fetch(
					new URL(`/api/collaboration/admission/decision`, ownerGateway.url),
					{
						body: JSON.stringify({
							decision: `reject`,
							requestId: rejectedRequest.id,
						}),
						headers: { "content-type": `application/json` },
						method: `POST`,
					},
				)
				expect(rejectedDecision.ok).toBe(true)
				await expect
					.poll(async () => {
						return (
							(await (
								await fetch(
									new URL(`/api/collaboration/session`, rejectedGateway.url),
								)
							).json()) as { admission: string }
						).admission
					})
					.toBe(`rejected`)
				expect(
					(await fetch(new URL(`/api/health`, rejectedGateway.url))).status,
				).toBe(401)
			} finally {
				await rejectedGateway.stop()
			}

			const request = await requestPinnedJson<{
				id: string
				pollToken: string
			}>({
				body: {
					claim: signIdentityClaim(guest, {
						audience: host.invitation.invitationToken,
						nonce: `gateway-test`,
					}),
					invitationToken: host.invitation.invitationToken,
				},
				fingerprint: host.fingerprint,
				method: `POST`,
				url: new URL(`/api/collaboration/admission`, host.invitation.address),
			})
			const decisionResponse = await fetch(
				new URL(`/api/collaboration/admission/decision`, ownerGateway.url),
				{
					body: JSON.stringify({
						decision: `approve`,
						requestId: request.id,
						role: `editor`,
					}),
					headers: { "content-type": `application/json` },
					method: `POST`,
				},
			)
			expect(decisionResponse.ok).toBe(true)
			const pollUrl = new URL(
				`/api/collaboration/admission`,
				host.invitation.address,
			)
			pollUrl.searchParams.set(`id`, request.id)
			const admitted = await requestPinnedJson<{
				decision: string
				sessionToken: string
			}>({
				fingerprint: host.fingerprint,
				token: request.pollToken,
				url: pollUrl,
			})
			expect(admitted.decision).toBe(`approved`)

			const guestPort = await availablePort()
			const guestGateway = await startLoopbackGateway({
				bearer: admitted.sessionToken,
				fingerprint: host.fingerprint,
				port: guestPort,
				target: new URL(host.invitation.address),
			})
			const guestSocket = io(guestGateway.url.href, {
				auth: { connectionId: `gateway-test` },
				path: CREATE_ART_REALTIME_PATH,
				transports: [`websocket`],
			})
			const participantEvents: unknown[] = []
			guestSocket.on(`collaboration:participants`, (participants) =>
				participantEvents.push(participants),
			)
			const secondGuestSocket = io(guestGateway.url.href, {
				auth: { connectionId: `gateway-test-second-tab` },
				path: CREATE_ART_REALTIME_PATH,
				transports: [`websocket`],
			})
			try {
				expect(
					(await fetch(new URL(`/api/ui-layouts`, ownerGateway.url))).status,
				).toBe(200)
				expect(
					(
						await fetch(new URL(`/api/health`, guestGateway.url), {
							method: `POST`,
						})
					).status,
				).toBe(403)
				expect(
					(await fetch(new URL(`/api/ui-layouts`, guestGateway.url))).status,
				).toBe(403)
				expect(
					(
						await fetch(
							new URL(
								`/api/collaboration/admission/decision`,
								guestGateway.url,
							),
							{
								body: JSON.stringify({ decision: `reject`, requestId: `none` }),
								headers: { "content-type": `application/json` },
								method: `POST`,
							},
						)
					).status,
				).toBe(403)
				await Promise.all(
					[guestSocket, secondGuestSocket].map(
						(socket) =>
							new Promise<void>((resolve, reject) => {
								if (socket.connected) {
									resolve()
									return
								}
								socket.once(`connect`, resolve)
								socket.once(`connect_error`, reject)
							}),
					),
				)
				const session = (await (
					await fetch(new URL(`/api/collaboration/session`, guestGateway.url))
				).json()) as {
					participants: CollaborationParticipant[]
					role: string
				}
				expect(session.role).toBe(`editor`)
				expect(JSON.stringify(session)).not.toContain(
					`synthetic-host-private-key`,
				)
				expect(JSON.stringify(session)).not.toContain(
					host.admissions.ownerToken,
				)
				expect(
					session.participants.find(
						(participant) => participant.role === `owner`,
					)?.identity,
				).toEqual({
					deviceId: owner.publicIdentity.deviceId,
					email: owner.publicIdentity.email,
					name: owner.publicIdentity.name,
					publicKey: owner.publicIdentity.publicKey,
				})
				expect(participantEvents.length).toBeGreaterThan(0)
				expect(JSON.stringify(participantEvents)).not.toContain(
					`synthetic-host-private-key`,
				)
				expect(
					session.participants.find(
						(participant) =>
							participant.identity.deviceId === guest.publicIdentity.deviceId,
					),
				).toMatchObject({ connected: true, connectedAt: expect.any(Number) })
				guestSocket.disconnect()
				expect(
					(
						(await (
							await fetch(
								new URL(`/api/collaboration/session`, guestGateway.url),
							)
						).json()) as { participants: CollaborationParticipant[] }
					).participants.find(
						(participant) =>
							participant.identity.deviceId === guest.publicIdentity.deviceId,
					)?.connected,
				).toBe(true)
				const disconnected = new Promise<void>((resolve) => {
					secondGuestSocket.once(`disconnect`, () => resolve())
				})
				const revoke = await fetch(
					new URL(`/api/collaboration/revoke`, ownerGateway.url),
					{
						body: JSON.stringify({ deviceId: guest.publicIdentity.deviceId }),
						headers: { "content-type": `application/json` },
						method: `POST`,
					},
				)
				expect(revoke.ok).toBe(true)
				await disconnected
				expect(
					(await fetch(new URL(`/api/collaboration/session`, guestGateway.url)))
						.status,
				).toBe(401)
			} finally {
				guestSocket.disconnect()
				secondGuestSocket.disconnect()
				await guestGateway.stop()
			}

			await expect(
				requestPinnedJson({
					fingerprint: `00`.repeat(32),
					url: new URL(`/`, host.invitation.address),
				}),
			).rejects.toThrow(`certificate`)
		} finally {
			await ownerGateway.stop()
			await host.stop()
			backend.closeAllConnections()
			await new Promise<void>((resolve) => backend.close(() => resolve()))
		}
	})
})
