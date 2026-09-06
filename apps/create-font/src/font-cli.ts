#!/usr/bin/env node

import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"

import {
	decodeInvitation,
	readOrCreateDeviceIdentity,
	rotateDeviceIdentity,
	signIdentityClaim,
} from "@create-art/realtime/node"
import {
	cli,
	help,
	options,
	optional,
	parseBooleanOption,
	parseNumberOption,
	parseStringOption,
	required,
} from "comline"
import { z } from "zod/v4"

import { CREATE_FONT_CLI_DEV_PORT } from "../../../scripts/dev-ports.ts"
import { installServerShutdown } from "../../../scripts/server-shutdown.ts"
import { buildProject } from "./build.ts"
import { checkFontProject, formatStylishCheck } from "./check.ts"
import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import { startCreateFontServer } from "./server.ts"
import { createFontCollaborationAuthority } from "./collaboration-authority.ts"
import {
	availableLoopbackPort,
	discoverLanAddress,
	openBrowser,
	requestPinnedJson,
	startLanHost,
	startLoopbackGateway,
} from "./lan-gateway.ts"
import { createFileSystemSourceService } from "./source-service.ts"
import { isMainModule } from "./runtime.ts"
import {
	discoverFontProjects,
	isFontProjectAvailable,
	selectFontProject,
} from "./workspace.ts"
import { buildFeaVsix, installFeaVsix } from "./vsix.ts"

const helpSchema = { help: z.boolean().optional() }
const helpConfig = {
	help: {
		description: `Show command help.`,
		example: `--help`,
		flag: `h`,
		parse: parseBooleanOption,
		required: false,
	},
} as const

const buildOptions = options(
	`Build a font project.`,
	z.object({ ...helpSchema, root: z.string().optional() }),
	{
		...helpConfig,
		root: {
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const checkOptions = options(
	`Check a font project's Adobe feature sources without writing artifacts.`,
	z.object({
		...helpSchema,
		format: z.string().optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		format: {
			description: `Diagnostic output format: stylish or json.`,
			example: `--format=json`,
			flag: `f`,
			parse: parseStringOption,
			required: false,
		},
		root: {
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
	},
)

const devOptions = options(
	`Start the interactive font workspace server.`,
	z.object({
		...helpSchema,
		hostname: z.string().optional(),
		port: z.number().int().min(1).max(65_535).optional(),
		root: z.string().optional(),
		share: z.boolean().optional(),
	}),
	{
		...helpConfig,
		hostname: {
			description: `Address to bind. Loopback is the default.`,
			example: `--hostname=127.0.0.1`,
			parse: parseStringOption,
			required: false,
		},
		port: {
			description: `TCP port. Defaults to ${CREATE_FONT_CLI_DEV_PORT}.`,
			example: `--port=${CREATE_FONT_CLI_DEV_PORT}`,
			flag: `p`,
			parse: parseNumberOption,
			required: false,
		},
		root: {
			description: `Font workspace root.`,
			example: `--root=.`,
			flag: `r`,
			parse: parseStringOption,
			required: false,
		},
		share: {
			description: `Share securely with admitted guests on the local network.`,
			example: `--share`,
			parse: parseBooleanOption,
			required: false,
		},
	},
)

const joinOptions = options(
	`Join a pinned LAN collaboration through a local identity gateway.`,
	z.object({
		...helpSchema,
		port: z.number().int().min(1).max(65_535).optional(),
	}),
	{
		...helpConfig,
		port: {
			description: `Local loopback port. Chooses an available port by default.`,
			example: `--port=${CREATE_FONT_CLI_DEV_PORT}`,
			flag: `p`,
			parse: parseNumberOption,
			required: false,
		},
	},
)

const vsixOptions = options(
	`Build and optionally install the Create Font Features VS Code extension.`,
	z.object({
		...helpSchema,
		"build-only": z.boolean().optional(),
		out: z.string().optional(),
		target: z.string().optional(),
	}),
	{
		...helpConfig,
		"build-only": {
			description: `Build the universal VSIX without installing it.`,
			example: `--build-only`,
			parse: parseBooleanOption,
			required: false,
		},
		out: {
			description: `Directory for the VSIX.`,
			example: `--out=artifacts`,
			flag: `o`,
			parse: parseStringOption,
			required: false,
		},
		target: {
			description: `VS Code-compatible editor command used for installation.`,
			example: `--target=code-insiders`,
			flag: `t`,
			parse: parseStringOption,
			required: false,
		},
	},
)

export const fontCli = cli({
	cliName: `font`,
	cliDescription: `Build and interactively edit fonts in a create-font workspace.`,
	routes: optional({
		build: optional({ $font: null }),
		check: optional({ $font: null }),
		dev: optional({ $font: null }),
		identity: required({ rotate: null }),
		join: optional({ $invitation: null }),
		serve: optional({ $font: null }),
		vsix: null,
	}),
	routeOptions: {
		"": options(`Show font help.`, z.object(helpSchema), helpConfig),
		build: buildOptions,
		"build/$font": buildOptions,
		check: checkOptions,
		"check/$font": checkOptions,
		dev: devOptions,
		"dev/$font": devOptions,
		"identity/rotate": options(
			`Replace the device signing key and remove obsolete configuration credentials. Stop running collaboration servers first.`,
			z.object(helpSchema),
			helpConfig,
		),
		join: joinOptions,
		"join/$invitation": joinOptions,
		serve: devOptions,
		"serve/$font": devOptions,
		vsix: vsixOptions,
	},
})

const execFileAsync = promisify(execFile)

async function gitIdentity(root: string) {
	const environmentName =
		process.env.CREATE_FONT_IDENTITY_NAME ?? process.env.GIT_AUTHOR_NAME
	const environmentEmail =
		process.env.CREATE_FONT_IDENTITY_EMAIL ?? process.env.GIT_AUTHOR_EMAIL
	if (environmentName !== undefined && environmentEmail !== undefined) {
		return { email: environmentEmail, name: environmentName }
	}
	const read = async (key: string): Promise<string> => {
		try {
			return (
				await execFileAsync(`git`, [`-C`, root, `config`, `--get`, key])
			).stdout.trim()
		} catch {
			return ``
		}
	}
	let [name, email] = await Promise.all([read(`user.name`), read(`user.email`)])
	if (name.length === 0 || email.length === 0) {
		if (!process.stdin.isTTY || !process.stderr.isTTY) {
			throw new Error(
				`Collaboration identity requires git user.name and user.email (or CREATE_FONT_IDENTITY_NAME and CREATE_FONT_IDENTITY_EMAIL).`,
			)
		}
		const prompt = createInterface({
			input: process.stdin,
			output: process.stderr,
		})
		try {
			if (name.length === 0)
				name = (await prompt.question(`Your name: `)).trim()
			if (email.length === 0)
				email = (await prompt.question(`Your email: `)).trim()
		} finally {
			prompt.close()
		}
		if (name.length === 0 || email.length === 0)
			throw new Error(`A name and email are required to collaborate.`)
	}
	return { email, name }
}

async function deviceIdentity(root: string, rotate = false) {
	const identity = await gitIdentity(root)
	const configuredRoot = process.env.XDG_CONFIG_HOME
	const configRoot =
		configuredRoot !== undefined && isAbsolute(configuredRoot)
			? configuredRoot
			: join(homedir(), `.config`)
	return (rotate ? rotateDeviceIdentity : readOrCreateDeviceIdentity)({
		...identity,
		legacyPath: join(configRoot, `create-art`, `identity.json`),
	})
}

export async function runFontCli(
	args: string[] = [`font`, ...process.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = fontCli(args)
		if (inputs.opts.help || inputs.case === ``) {
			writeLine(io.stdout, help(fontCli.definition))
			return 0
		}
		if (inputs.case === `identity/rotate`) {
			const identity = await deviceIdentity(process.cwd(), true)
			writeLine(
				io.stdout,
				`Device identity rotated to ${identity.publicIdentity.deviceId}. Any obsolete identity.json was removed without a backup. Restart all collaboration servers and obtain fresh invitations; existing processes retain their old credentials until stopped.`,
			)
			return 0
		}
		if (inputs.case === `join` || inputs.case === `join/$invitation`) {
			const encoded = inputs.path[1]
			if (encoded === undefined)
				throw new Error(`A collaboration invitation is required.`)
			const invitation = decodeInvitation(encoded)
			const identity = await deviceIdentity(process.cwd())
			const target = new URL(invitation.address)
			writeLine(
				io.stdout,
				`Requesting admission to ${target.host} as ${identity.publicIdentity.name} <${identity.publicIdentity.email}>.`,
			)
			const admissionUrl = new URL(`/api/collaboration/admission`, target)
			const admission = await requestPinnedJson<{
				id: string
				pollToken: string
			}>({
				body: {
					claim: signIdentityClaim(identity, {
						audience: invitation.invitationToken,
						nonce: randomUUID(),
					}),
					invitationToken: invitation.invitationToken,
				},
				fingerprint: invitation.certificateFingerprint,
				method: `POST`,
				url: admissionUrl,
			})
			const gateway = await startLoopbackGateway({
				fingerprint: invitation.certificateFingerprint,
				pending: admission,
				port: inputs.opts.port ?? (await availableLoopbackPort()),
				target,
			})
			installServerShutdown({ stop: gateway.stop })
			writeLine(
				io.stdout,
				`Waiting for ${target.host} to admit ${identity.publicIdentity.name} <${identity.publicIdentity.email}>.`,
			)
			writeLine(io.stdout, `Open ${gateway.url}`)
			openBrowser(gateway.url)
			return 0
		}
		if (inputs.case === `vsix`) {
			const result = await buildFeaVsix({
				outdir: inputs.opts.out ?? `artifacts`,
			})
			writeLine(io.stdout, result.vsixPath)
			if (!inputs.opts[`build-only`])
				await installFeaVsix(
					result.vsixPath,
					inputs.opts.target ?? `code`,
					process.cwd(),
				)
			return 0
		}
		const project = await selectFontProject(inputs.opts.root, inputs.path[1])
		if (inputs.case === `check` || inputs.case === `check/$font`) {
			if (
				inputs.opts.format !== undefined &&
				inputs.opts.format !== `stylish` &&
				inputs.opts.format !== `json`
			)
				throw new Error(`Format must be stylish or json.`)
			const result = await checkFontProject(project.root)
			writeLine(
				inputs.opts.format === `json` ? io.stdout : io.stderr,
				inputs.opts.format === `json`
					? JSON.stringify(result.diagnostics, null, 2)
					: await formatStylishCheck(result),
			)
			return result.ok ? 0 : 1
		}
		if (inputs.case === `build` || inputs.case === `build/$font`) {
			const result = await buildProject(project.root)
			if (result.ok) {
				for (const output of result.outputs) writeLine(io.stdout, output)
				return 0
			}
			for (const diagnostic of result.errors) {
				writeLine(
					io.stderr,
					`${diagnostic.code}: ${diagnostic.message} (${diagnostic.path})`,
				)
			}
			return 1
		}

		const { hostname, port } = inputs.opts
		const workspaceRoot = inputs.opts.root ?? process.cwd()
		const discovered = await discoverFontProjects(workspaceRoot)
		const mounted = (
			await Promise.all(
				discovered.map(async (candidate) => {
					try {
						return {
							available: () => isFontProjectAvailable(candidate.root),
							id: candidate.name,
							name: candidate.name,
							path: candidate.path,
							root: candidate.root,
							source: await createFileSystemSourceService(candidate.root),
						}
					} catch (error) {
						if (candidate.root === project.root) throw error
						return null
					}
				}),
			)
		).filter((candidate) => candidate !== null)
		const active = mounted.find(({ root }) => root === project.root)
		if (active === undefined)
			throw new Error(`The selected font could not be mounted.`)
		if (inputs.opts.share) {
			const identity = await deviceIdentity(project.root)
			const internalPort = await availableLoopbackPort()
			const internal = startCreateFontServer({
				activeProjectId: active.id,
				hostname: `127.0.0.1`,
				port: internalPort,
				projects: [active],
				root: active.root,
				source: active.source,
				workspaceRoot,
			})
			const authority = await createFontCollaborationAuthority(active.source)
			let shared: Awaited<ReturnType<typeof startLanHost>> | undefined
			let gateway: Awaited<ReturnType<typeof startLoopbackGateway>>
			try {
				shared = await startLanHost({
					address: hostname ?? discoverLanAddress(),
					authority,
					identity: identity.publicIdentity,
					internalUrl: internal.url,
					port: port ?? CREATE_FONT_CLI_DEV_PORT,
				})
				gateway = await startLoopbackGateway({
					bearer: shared.admissions.ownerToken,
					fingerprint: shared.fingerprint,
					port: port ?? CREATE_FONT_CLI_DEV_PORT,
					target: new URL(shared.invitation.address),
				})
			} catch (error) {
				if (shared === undefined) authority.dispose()
				else await shared.stop()
				await internal.app.stop(true)
				throw error
			}
			installServerShutdown({
				stop: async () => {
					await gateway.stop()
					await shared.stop()
					await internal.app.stop(true)
				},
			})
			writeLine(io.stdout, `font is serving ${project.path} at ${gateway.url}`)
			writeLine(
				io.stdout,
				`LAN sharing is active at ${shared.invitation.address}; only admit people you trust.`,
			)
			writeLine(io.stdout, `Invite with: font join '${shared.joinToken}'`)
			writeLine(io.stdout, shared.qr)
			openBrowser(gateway.url)
			return 0
		}
		const server = startCreateFontServer({
			...(hostname === undefined ? {} : { hostname }),
			activeProjectId: active.id,
			port: port ?? CREATE_FONT_CLI_DEV_PORT,
			projects: mounted,
			root: active.root,
			source: active.source,
			workspaceRoot,
		})
		installServerShutdown({ stop: () => server.app.stop(true) })
		writeLine(io.stdout, `font is serving ${project.path} at ${server.url}`)
		return 0
	} catch (error) {
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (isMainModule(import.meta.url)) {
	const exitCode = await runFontCli()
	process.exitCode ??= exitCode
}
