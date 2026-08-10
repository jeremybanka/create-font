import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, normalize, resolve } from "node:path"

import { normalizeSpriteProject } from "./model.ts"
import { readSpriteSource, writeSpriteSource } from "./source.ts"

const JSON_LIMIT = 16 * 1024 * 1024
const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
}

export interface SpriteServerOptions {
	readonly root: string
	readonly port: number
	readonly hostname?: string
	readonly assets?: string
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
	const body = JSON.stringify(value)
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body),
		"content-type": "application/json; charset=utf-8",
	})
	response.end(body)
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		size += buffer.length
		if (size > JSON_LIMIT) throw new Error(`Sprite project exceeds the ${JSON_LIMIT / 1024 / 1024} MB request limit.`)
		chunks.push(buffer)
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function serveFile(response: ServerResponse, path: string): Promise<boolean> {
	try {
		const info = await stat(path)
		if (!info.isFile()) return false
		response.writeHead(200, {
			"cache-control": path.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
			"content-length": info.size,
			"content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
		})
		createReadStream(path).pipe(response)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
		throw error
	}
}

export function createSpriteServer(options: SpriteServerOptions): Server {
	const projectRoot = resolve(options.root)
	const assetsRoot = options.assets === undefined ? undefined : resolve(options.assets)
	return createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
			if (url.pathname === "/api/health") {
				sendJson(response, 200, { ok: true, product: "create-sprites" })
				return
			}
			if (url.pathname === "/api/project" && request.method === "GET") {
				sendJson(response, 200, await readSpriteSource(projectRoot))
				return
			}
			if (url.pathname === "/api/project" && request.method === "PUT") {
				const project = normalizeSpriteProject(await requestJson(request))
				await writeSpriteSource(projectRoot, project)
				sendJson(response, 200, { ok: true })
				return
			}
			if (url.pathname.startsWith("/api/")) {
				sendJson(response, 404, { error: "Unknown create-sprites API route." })
				return
			}
			if (assetsRoot !== undefined && (request.method === "GET" || request.method === "HEAD")) {
				const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "")
				const candidate = resolve(assetsRoot, relative || "index.html")
				if (candidate.startsWith(`${assetsRoot}/`) || candidate === join(assetsRoot, "index.html")) {
					if (await serveFile(response, candidate)) return
					if (await serveFile(response, join(assetsRoot, "index.html"))) return
				}
			}
			sendJson(response, 404, { error: "Not found." })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			sendJson(response, 400, { error: message })
		}
	})
}

export async function startSpriteServer(options: SpriteServerOptions): Promise<Server> {
	const server = createSpriteServer(options)
	await new Promise<void>((accept, reject) => {
		server.once("error", reject)
		server.listen(options.port, options.hostname ?? "127.0.0.1", () => {
			server.off("error", reject)
			accept()
		})
	})
	return server
}
