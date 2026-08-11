import { createHash, X509Certificate } from "node:crypto"
import { spawn } from "node:child_process"
import * as http from "node:http"
import * as https from "node:https"
import { createServer as createNetServer, type AddressInfo } from "node:net"
import { networkInterfaces } from "node:os"
import * as tls from "node:tls"

import {
	CREATE_ART_REALTIME_PATH,
	type CollaborationRole,
	type HostInvitation,
	type SignedIdentityClaim,
} from "@create-art/realtime"
import {
	createAdmissionAuthority,
	encodeInvitation,
	type readOrCreateDeviceIdentity,
} from "@create-art/realtime/node"
import { provideAuthoritativeActions } from "@create-art/realtime/server"
import type { EditorFontSource, FontDocumentCommand } from "@create-font/states"
import { type UserKey } from "atom.io/realtime"
import { realtime } from "atom.io/realtime-server"
import QRCode from "qrcode"
import selfsigned from "selfsigned"
import { Server as SocketIoServer } from "socket.io"

import {
	isFontDocumentCommand,
	type createFontCollaborationAuthority,
} from "./collaboration-authority.ts"

type DeviceIdentity = Awaited<ReturnType<typeof readOrCreateDeviceIdentity>>
type FontAuthority = Awaited<
	ReturnType<typeof createFontCollaborationAuthority>
>

export function discoverLanAddress(): string {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const address of addresses ?? []) {
			if (address.family === `IPv4` && !address.internal) return address.address
		}
	}
	throw new Error(`No LAN IPv4 address is available for sharing.`)
}

export async function availableLoopbackPort(): Promise<number> {
	const server = createNetServer()
	await new Promise<void>((resolve, reject) => {
		server.once(`error`, reject)
		server.listen(0, `127.0.0.1`, resolve)
	})
	const port = (server.address() as AddressInfo).port
	await new Promise<void>((resolve) => server.close(() => resolve()))
	return port
}

function bearer(request: http.IncomingMessage): string | undefined {
	const authorization = request.headers.authorization
	return authorization?.startsWith(`Bearer `)
		? authorization.slice(`Bearer `.length)
		: undefined
}

function hasExpectedHost(
	request: http.IncomingMessage,
	expectedHost: string,
): boolean {
	return request.headers.host?.toLowerCase() === expectedHost.toLowerCase()
}

async function bodyJson(request: http.IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = []
	let length = 0
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		length += buffer.length
		if (length > 256 * 1024) throw new Error(`Request body is too large.`)
		chunks.push(buffer)
	}
	return JSON.parse(Buffer.concat(chunks).toString(`utf8`))
}

function json(
	response: http.ServerResponse,
	status: number,
	value: unknown,
): void {
	const data = Buffer.from(JSON.stringify(value))
	response.writeHead(status, {
		"cache-control": `no-store`,
		"content-length": data.length,
		"content-type": `application/json; charset=utf-8`,
	})
	response.end(data)
}

function normalizedFingerprint(value: string): string {
	return value.replaceAll(`:`, ``).toLowerCase()
}

function certificateMatches(
	socket: tls.TLSSocket,
	expectedFingerprint: string,
): boolean {
	const certificate = socket.getPeerCertificate(true)
	if (certificate.raw === undefined) return false
	const actual = createHash(`sha256`).update(certificate.raw).digest(`hex`)
	return actual === normalizedFingerprint(expectedFingerprint)
}

async function readPinnedCertificate(
	target: URL,
	expectedFingerprint: string,
): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const socket = tls.connect({
			host: target.hostname,
			port: Number(target.port || 443),
			rejectUnauthorized: false,
		})
		let settled = false
		const fail = (error: Error): void => {
			if (settled) return
			settled = true
			socket.destroy()
			reject(error)
		}
		socket.once(`secureConnect`, () => {
			if (!certificateMatches(socket, expectedFingerprint)) {
				fail(
					new Error(
						`The host TLS certificate does not match the invitation pin.`,
					),
				)
				return
			}
			const certificate = socket.getPeerCertificate(true)
			if (certificate.raw === undefined) {
				fail(new Error(`The host did not present a TLS certificate.`))
				return
			}
			settled = true
			resolve(new X509Certificate(certificate.raw).toString())
			socket.end()
		})
		socket.once(`error`, fail)
	})
}

function proxyHttp(
	request: http.IncomingMessage,
	response: http.ServerResponse,
	options: {
		readonly agent?: http.Agent | https.Agent
		readonly authorization?: string
		readonly origin?: string
		readonly target: URL
		readonly upstreams?: Set<CloseableSocket>
	},
): void {
	const secure = options.target.protocol === `https:`
	const headers = { ...request.headers, host: options.target.host }
	if (options.authorization !== undefined) {
		headers.authorization = `Bearer ${options.authorization}`
	}
	if (options.origin !== undefined) headers.origin = options.origin
	const proxyRequest = (secure ? https : http).request(
		{
			...(options.agent === undefined ? {} : { agent: options.agent }),
			headers,
			hostname: options.target.hostname,
			method: request.method,
			path: request.url,
			port: options.target.port,
		},
		(proxyResponse) => {
			response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
			proxyResponse.pipe(response)
		},
	)
	proxyRequest.on(`error`, (error) => {
		if (!response.headersSent)
			json(response, 502, {
				code: `gateway.unavailable`,
				message: error.message,
			})
		else response.destroy(error)
	})
	proxyRequest.once(`socket`, (socket) => {
		if (options.upstreams?.has(socket) === false) {
			options.upstreams.add(socket)
			socket.once(`close`, () => options.upstreams?.delete(socket))
		}
	})
	request.pipe(proxyRequest)
}

function upgradeHeaders(
	request: http.IncomingMessage,
	target: URL,
	authorization?: string,
	origin?: string,
): string {
	const headers = { ...request.headers, host: target.host }
	if (authorization !== undefined) {
		headers.authorization = `Bearer ${authorization}`
	}
	if (origin !== undefined) headers.origin = origin
	const lines = [
		`${request.method ?? `GET`} ${request.url ?? `/`} HTTP/${request.httpVersion}`,
	]
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue
		for (const item of Array.isArray(value) ? value : [value]) {
			lines.push(`${name}: ${item}`)
		}
	}
	return `${lines.join(`\r\n`)}\r\n\r\n`
}

function proxyUpgrade(
	request: http.IncomingMessage,
	client: import("node:stream").Duplex,
	head: Buffer,
	options: {
		readonly authorization?: string
		readonly certificate?: string
		readonly fingerprint?: string
		readonly origin?: string
		readonly target: URL
		readonly upstreams?: Set<CloseableSocket>
	},
): void {
	const bun = (
		Reflect.get(process.versions, `bun`) === undefined
			? undefined
			: Reflect.get(globalThis, `Bun`)
	) as
		| {
				connect?: (options: {
					hostname: string
					port: number
					socket: {
						close(socket: BunProxySocket): void
						connectError(socket: BunProxySocket, error: Error): void
						data(socket: BunProxySocket, data: Uint8Array): void
						error(socket: BunProxySocket, error: Error): void
						open(socket: BunProxySocket): void
					}
					tls?: boolean | Readonly<{ ca: string; rejectUnauthorized: boolean }>
				}) => Promise<BunProxySocket>
		  }
		| undefined
	if (bun?.connect !== undefined) {
		void bun
			.connect({
				hostname: options.target.hostname,
				port: Number(
					options.target.port ||
						(options.target.protocol === `https:` ? 443 : 80),
				),
				socket: {
					close: (socket) => {
						options.upstreams?.delete(socket)
						client.end()
					},
					connectError: (_socket, error) => client.destroy(error),
					data: (_socket, data) => {
						client.write(data)
					},
					error: (_socket, error) => client.destroy(error),
					open: (upstream) => {
						options.upstreams?.add(upstream)
						upstream.write(
							upgradeHeaders(
								request,
								options.target,
								options.authorization,
								options.origin,
							),
						)
						if (head.length > 0) upstream.write(head)
						client.on(`data`, (data) => upstream.write(data))
						client.once(`close`, () => upstream.end())
					},
				},
				...(options.target.protocol === `https:`
					? {
							tls:
								options.certificate === undefined
									? true
									: {
											ca: options.certificate,
											rejectUnauthorized: true,
										},
						}
					: {}),
			})
			.catch((error: unknown) =>
				client.destroy(
					error instanceof Error ? error : new Error(String(error)),
				),
			)
		return
	}
	const connect = () => {
		if (options.target.protocol === `https:`) {
			return tls.connect({
				host: options.target.hostname,
				port: Number(options.target.port || 443),
				rejectUnauthorized: false,
			})
		}
		return import("node:net").then(({ connect }) =>
			connect(Number(options.target.port || 80), options.target.hostname),
		)
	}
	void Promise.resolve(connect()).then((upstream) => {
		options.upstreams?.add(upstream)
		upstream.once(`close`, () => options.upstreams?.delete(upstream))
		const ready = () => {
			if (
				upstream instanceof tls.TLSSocket &&
				options.fingerprint !== undefined &&
				!certificateMatches(upstream, options.fingerprint)
			) {
				upstream.destroy(new Error(`Host TLS certificate pin mismatch.`))
				client.destroy()
				return
			}
			upstream.write(
				upgradeHeaders(
					request,
					options.target,
					options.authorization,
					options.origin,
				),
			)
			if (head.length > 0) upstream.write(head)
			client.once(`close`, () => upstream.destroy())
			upstream.once(`close`, () => client.destroy())
			upstream.pipe(client)
			client.pipe(upstream)
		}
		upstream.once(
			options.target.protocol === `https:` ? `secureConnect` : `connect`,
			ready,
		)
		upstream.on(`error`, () => client.destroy())
	})
}

interface CloseableSocket {
	destroy?(error?: Error): void
	end(): void
}

interface BunProxySocket extends CloseableSocket {
	write(data: string | Uint8Array): number
}

async function listen(
	server: http.Server | https.Server,
	port: number,
	host: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.once(`error`, reject)
		server.listen(port, host, () => {
			server.off(`error`, reject)
			resolve()
		})
	})
}

function trackConnections(
	server: http.Server | https.Server,
): ReadonlySet<import("node:net").Socket> {
	const connections = new Set<import("node:net").Socket>()
	server.on(`connection`, (socket) => {
		connections.add(socket)
		socket.once(`close`, () => connections.delete(socket))
	})
	return connections
}

function closeConnections(connections: ReadonlySet<CloseableSocket>): void {
	for (const connection of connections) {
		if (connection.destroy === undefined) connection.end()
		else connection.destroy()
	}
}

export async function requestPinnedJson<Result>(options: {
	readonly body?: unknown
	readonly fingerprint: string
	readonly method?: string
	readonly token?: string
	readonly url: URL
}): Promise<Result> {
	const body =
		options.body === undefined ? undefined : JSON.stringify(options.body)
	const certificate = await readPinnedCertificate(
		options.url,
		options.fingerprint,
	)
	const agent = new https.Agent({ ca: certificate, keepAlive: true })
	try {
		return await new Promise<Result>((resolve, reject) => {
			const request = https.request(
				options.url,
				{
					agent,
					headers: {
						...(options.token === undefined
							? {}
							: { authorization: `Bearer ${options.token}` }),
						...(body === undefined
							? {}
							: {
									"content-length": Buffer.byteLength(body),
									"content-type": `application/json`,
								}),
					},
					method: options.method ?? `GET`,
				},
				(response) => {
					const chunks: Buffer[] = []
					response.on(`data`, (chunk) => chunks.push(Buffer.from(chunk)))
					response.on(`end`, () => {
						const data = JSON.parse(
							Buffer.concat(chunks).toString(`utf8`),
						) as Result
						if ((response.statusCode ?? 500) >= 400) {
							reject(
								new Error(
									(data as { message?: string }).message ??
										`Host request failed.`,
								),
							)
							return
						}
						resolve(data)
					})
				},
			)
			request.on(`error`, reject)
			request.end(body)
		})
	} finally {
		agent.destroy()
	}
}

export async function startLanHost(options: {
	readonly address: string
	readonly authority: FontAuthority
	readonly identity: DeviceIdentity
	readonly internalUrl: URL
	readonly port: number
}) {
	const certificate = await selfsigned.generate(
		[{ name: `commonName`, value: options.address }],
		{
			algorithm: `sha256`,
			days: 2,
			extensions: [
				{
					name: `subjectAltName`,
					altNames: [
						/^\d+\.\d+\.\d+\.\d+$/.test(options.address)
							? { ip: options.address, type: 7 }
							: { type: 2, value: options.address },
					],
				},
			],
			keySize: 2048,
		},
	)
	const fingerprint = new X509Certificate(certificate.cert).fingerprint256
	const invitationIssuedAt = Date.now()
	const invitationExpiresAt = invitationIssuedAt + 12 * 60 * 60 * 1_000
	const admissions = createAdmissionAuthority({
		invitationExpiresAt,
		owner: options.identity,
	})
	const upstreams = new Set<CloseableSocket>()
	const internalAgent =
		options.internalUrl.protocol === `https:`
			? new https.Agent({ keepAlive: true })
			: new http.Agent({ keepAlive: true })
	const expectedHost = `${options.address}:${options.port}`
	const hostOrigin = `https://${expectedHost}`
	let io: SocketIoServer
	const server = https.createServer(
		{ cert: certificate.cert, key: certificate.private },
		async (request, response) => {
			if (!hasExpectedHost(request, expectedHost)) {
				json(response, 421, { message: `The request host is not allowed.` })
				return
			}
			if (
				request.headers.origin !== undefined &&
				request.headers.origin !== hostOrigin
			) {
				json(response, 403, { message: `The request origin is not allowed.` })
				return
			}
			const url = new URL(request.url ?? `/`, `https://${request.headers.host}`)
			try {
				if (
					url.pathname === `/api/collaboration/admission` &&
					request.method === `POST`
				) {
					const data = (await bodyJson(request)) as {
						claim: SignedIdentityClaim
						invitationToken: string
					}
					const result = admissions.request(data.claim, data.invitationToken)
					json(
						response,
						result === null ? 401 : 202,
						result ?? { message: `Invalid invitation or identity proof.` },
					)
					return
				}
				if (
					url.pathname === `/api/collaboration/admission` &&
					request.method === `GET`
				) {
					const result = admissions.poll(
						url.searchParams.get(`id`) ?? ``,
						bearer(request) ?? ``,
					)
					json(
						response,
						result === null ? 404 : 200,
						result ?? { message: `Unknown admission request.` },
					)
					return
				}
				const session = admissions.authenticate(bearer(request))
				if (url.pathname === `/api/collaboration/session`) {
					json(
						response,
						session === null ? 401 : 200,
						session === null
							? { message: `A collaboration session is required.` }
							: {
									admission: `approved`,
									identity: session.identity,
									participants: admissions.participants(),
									...(session.role === `owner`
										? { pending: admissions.pending() }
										: {}),
									role: session.role,
								},
					)
					return
				}
				if (
					url.pathname === `/api/collaboration/admission/decision` &&
					request.method === `POST`
				) {
					if (session?.role !== `owner`) {
						json(response, 403, { message: `Only the host can admit guests.` })
						return
					}
					const data = (await bodyJson(request)) as {
						requestId: string
						role?: CollaborationRole
						decision: `approve` | `reject`
					}
					const result =
						data.decision === `approve`
							? admissions.approve(
									data.requestId,
									data.role === `viewer` ? `viewer` : `editor`,
								)
							: admissions.reject(data.requestId)
					io.emit(`collaboration:participants`, admissions.participants())
					json(response, result ? 200 : 404, { ok: Boolean(result) })
					return
				}
				if (
					url.pathname === `/api/collaboration/revoke` &&
					request.method === `POST`
				) {
					if (session?.role !== `owner`) {
						json(response, 403, { message: `Only the host can revoke guests.` })
						return
					}
					const data = (await bodyJson(request)) as { deviceId: string }
					const sockets = [...io.sockets.sockets.values()].filter((socket) => {
						const header = socket.handshake.headers.authorization
						const token = header?.startsWith(`Bearer `)
							? header.slice(7)
							: undefined
						return (
							admissions.authenticate(token)?.identity.deviceId ===
							data.deviceId
						)
					})
					const revoked = admissions.revoke(data.deviceId)
					for (const socket of sockets) socket.disconnect(true)
					io.emit(`collaboration:participants`, admissions.participants())
					json(response, revoked ? 200 : 404, { ok: revoked })
					return
				}
				if (session === null && !url.pathname.startsWith(`/api/`)) {
					proxyHttp(request, response, {
						agent: internalAgent,
						target: options.internalUrl,
						upstreams,
					})
					return
				}
				if (session === null) {
					json(response, 401, {
						message: `A collaboration session is required.`,
					})
					return
				}
				const ownerOnly =
					request.method !== `GET` ||
					url.pathname.startsWith(`/api/build`) ||
					url.pathname.includes(`/commit`) ||
					url.pathname.includes(`/comparison`)
				if (
					url.pathname.startsWith(`/api/`) &&
					ownerOnly &&
					session.role !== `owner`
				) {
					json(response, 403, {
						message: `This operation is reserved for the host.`,
					})
					return
				}
				proxyHttp(request, response, {
					agent: internalAgent,
					target: options.internalUrl,
					upstreams,
				})
			} catch (error) {
				json(response, 400, {
					message: error instanceof Error ? error.message : String(error),
				})
			}
		},
	)
	const connections = trackConnections(server)
	const bunRuntime = Reflect.get(process.versions, `bun`) !== undefined
	io = new SocketIoServer(server, {
		allowRequest(request, callback) {
			const allowed =
				hasExpectedHost(request, expectedHost) &&
				(request.headers.origin === undefined ||
					request.headers.origin === hostOrigin)
			callback(
				allowed ? null : `The collaboration request origin is not allowed.`,
				allowed,
			)
		},
		maxHttpBufferSize: 512 * 1024,
		path: CREATE_ART_REALTIME_PATH,
		serveClient: false,
		...(bunRuntime ? { transports: [`polling`] } : {}),
	})
	const disposeRealtime = realtime(
		io,
		(handshake) => {
			const header = handshake.headers.authorization
			const token = header?.startsWith(`Bearer `) ? header.slice(7) : undefined
			const session = admissions.authenticate(token)
			if (session === null)
				return new Error(`A collaboration session is required.`)
			const connectionId =
				typeof handshake.auth.connectionId === `string`
					? handshake.auth.connectionId
							.replaceAll(/[^a-zA-Z0-9_-]/g, ``)
							.slice(0, 64)
					: `connection`
			return `user::${session.identity.deviceId}:${connectionId}` as UserKey
		},
		({ socket }) => {
			const header = (
				socket as unknown as {
					handshake: { headers: { authorization?: string } }
				}
			).handshake.headers.authorization
			const token = header?.startsWith(`Bearer `) ? header.slice(7) : ``
			const session = admissions.authenticate(token)
			if (session === null) return () => {}
			admissions.connectionOpened(token)
			const expirationTimer =
				session.expiresAt === null
					? undefined
					: setTimeout(
							() => {
								admissions.expire(token)
								socket.disconnect(true)
								io.emit(`collaboration:participants`, admissions.participants())
							},
							Math.max(0, session.expiresAt - Date.now()),
						)
			expirationTimer?.unref()
			io.emit(`collaboration:participants`, admissions.participants())
			const disposeActions = provideAuthoritativeActions<
				EditorFontSource,
				FontDocumentCommand
			>({
				apply: options.authority.apply,
				deviceId: session.identity.deviceId,
				participants: admissions.participants,
				role: session.role,
				snapshot: options.authority.snapshot,
				socket: socket as never,
				validateCommand: isFontDocumentCommand,
			})
			return () => {
				if (expirationTimer !== undefined) clearTimeout(expirationTimer)
				disposeActions()
				admissions.connectionClosed(token)
				io.emit(`collaboration:participants`, admissions.participants())
			}
		},
	)
	const disposeReset = options.authority.onReset((snapshot) => {
		io.emit(`collaboration:reset`, snapshot)
	})
	server.on(`upgrade`, (request, client, head) => {
		if (!hasExpectedHost(request, expectedHost)) {
			client.destroy()
			return
		}
		if (request.url?.startsWith(CREATE_ART_REALTIME_PATH)) {
			return
		}
		const session = admissions.authenticate(bearer(request))
		if (session === null) {
			client.destroy()
			return
		}
		proxyUpgrade(request, client, head, {
			target: options.internalUrl,
			upstreams,
		})
	})
	await listen(server, options.port, options.address)
	const invitation: HostInvitation = {
		address: `https://${options.address}:${options.port}`,
		certificateFingerprint: fingerprint,
		expiresAt: invitationExpiresAt,
		invitationToken: admissions.invitationToken,
		issuedAt: invitationIssuedAt,
		protocol: 1,
	}
	const joinToken = encodeInvitation(invitation)
	return {
		admissions,
		fingerprint,
		invitation,
		joinToken,
		qr: await QRCode.toString(joinToken, { type: `terminal`, small: true }),
		async stop(): Promise<void> {
			disposeReset()
			options.authority.dispose()
			await disposeRealtime()
			await new Promise<void>((resolve) => io.close(() => resolve()))
			internalAgent.destroy()
			closeConnections(upstreams)
			closeConnections(connections)
			if (server.listening) {
				await new Promise<void>((resolve) => server.close(() => resolve()))
			}
		},
	}
}

export async function startLoopbackGateway(options: {
	readonly bearer?: string
	readonly fingerprint: string
	readonly pending?: Readonly<{ id: string; pollToken: string }>
	readonly port: number
	readonly target: URL
}) {
	let sessionToken = options.bearer
	const upstreams = new Set<CloseableSocket>()
	let admission: `approved` | `pending` | `rejected` =
		sessionToken === undefined ? `pending` : `approved`
	const certificate = await readPinnedCertificate(
		options.target,
		options.fingerprint,
	)
	const agent = new https.Agent({ ca: certificate, keepAlive: true })
	const gatewayOrigin = `http://127.0.0.1:${options.port}`
	const expectedHost = `127.0.0.1:${options.port}`
	const server = http.createServer((request, response) => {
		if (!hasExpectedHost(request, expectedHost)) {
			json(response, 421, { message: `The request host is not allowed.` })
			return
		}
		if (
			request.headers.origin !== undefined &&
			request.headers.origin !== gatewayOrigin
		) {
			json(response, 403, {
				message: `Cross-origin gateway requests are forbidden.`,
			})
			return
		}
		const url = new URL(request.url ?? `/`, `http://${request.headers.host}`)
		if (
			url.pathname === `/api/collaboration/session` &&
			sessionToken === undefined
		) {
			json(response, 200, {
				admission,
				participants: [],
				requestId: options.pending?.id,
			})
			return
		}
		proxyHttp(request, response, {
			agent,
			...(sessionToken === undefined ? {} : { authorization: sessionToken }),
			origin: options.target.origin,
			target: options.target,
			upstreams,
		})
	})
	const connections = trackConnections(server)
	server.on(`upgrade`, (request, client, head) => {
		if (
			sessionToken === undefined ||
			!hasExpectedHost(request, expectedHost) ||
			(request.headers.origin !== undefined &&
				request.headers.origin !== gatewayOrigin)
		) {
			client.destroy()
			return
		}
		proxyUpgrade(request, client, head, {
			authorization: sessionToken,
			certificate,
			fingerprint: options.fingerprint,
			origin: options.target.origin,
			target: options.target,
			upstreams,
		})
	})
	await listen(server, options.port, `127.0.0.1`)
	let pollTimer: ReturnType<typeof setInterval> | undefined
	if (options.pending !== undefined) {
		pollTimer = setInterval(() => {
			const pollUrl = new URL(`/api/collaboration/admission`, options.target)
			pollUrl.searchParams.set(`id`, options.pending!.id)
			void requestPinnedJson<{
				decision: typeof admission
				sessionToken?: string
			}>({
				fingerprint: options.fingerprint,
				token: options.pending!.pollToken,
				url: pollUrl,
			})
				.then((result) => {
					admission = result.decision
					if (result.sessionToken !== undefined) {
						sessionToken = result.sessionToken
					}
					if (admission !== `pending` && pollTimer !== undefined)
						clearInterval(pollTimer)
				})
				.catch(() => undefined)
		}, 500)
		pollTimer.unref()
	}
	return {
		url: new URL(gatewayOrigin),
		async stop(): Promise<void> {
			if (pollTimer !== undefined) clearInterval(pollTimer)
			agent.destroy()
			closeConnections(upstreams)
			closeConnections(connections)
			await new Promise<void>((resolve) => server.close(() => resolve()))
		},
	}
}

export function openBrowser(url: URL): void {
	if (process.env.CREATE_FONT_NO_OPEN === `1`) return
	const [command, parameters] =
		process.platform === `darwin`
			? [`open`, [url.href]]
			: process.platform === `win32`
				? [`cmd`, [`/c`, `start`, ``, url.href]]
				: [`xdg-open`, [url.href]]
	const child = spawn(command, parameters, { detached: true, stdio: `ignore` })
	child.unref()
}
