import { resolve } from "node:path"

import { Elysia } from "elysia"

import { createTrigraphRpc } from "./rpc.ts"

const editorIntegrationPending = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>Trigraph</title>
	</head>
	<body>
		<main>
			<h1>Trigraph workspace server</h1>
			<p>The Elysia RPC is running. Editor integration is the next step.</p>
		</main>
	</body>
</html>
`

export type CreateTrigraphServerOptions = Readonly<{
	root?: string
}>

export function createTrigraphServerApp(
	options: CreateTrigraphServerOptions = {},
) {
	const root = resolve(options.root ?? process.cwd())

	return new Elysia({ name: `trigraph-server` })
		.use(createTrigraphRpc({ root }))
		.get(`/`, ({ set }) => {
			set.headers[`content-type`] = `text/html; charset=utf-8`
			return editorIntegrationPending
		})
}

export type TrigraphServerApp = ReturnType<typeof createTrigraphServerApp>

export type StartTrigraphServerOptions = CreateTrigraphServerOptions &
	Readonly<{
		hostname?: string
		port?: number
	}>

export function startTrigraphServer(options: StartTrigraphServerOptions = {}) {
	const app = createTrigraphServerApp(options).listen({
		hostname: options.hostname ?? `127.0.0.1`,
		port: options.port ?? 4173,
	})
	const server = app.server
	if (server === null) {
		throw new Error(`Elysia did not create a Bun server.`)
	}
	return {
		app,
		url: server.url,
	}
}
