import type { ElysiaAdapter } from "elysia/adapter"

async function selectElysiaAdapter(): Promise<ElysiaAdapter> {
	if (`Bun` in globalThis) {
		const { BunAdapter } = await import("elysia/adapter/bun")
		return BunAdapter
	}
	const { node } = await import("@elysia/node")
	const adapter = node()
	return {
		...adapter,
		listen(app) {
			const listen = adapter.listen(app)
			return (options, callback) =>
				listen(options, (server) => {
					app.server = server
					callback?.(server)
				})
		},
		async stop(app, closeActiveConnections) {
			app.server?.stop(closeActiveConnections)
		},
	}
}

export const runtimeElysiaAdapter = await selectElysiaAdapter()
