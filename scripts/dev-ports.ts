export const DEFAULT_DEV_PORT = 16_384
export const WORKSPACE_DEV_PORT_COUNT = 4

export type WorkspaceDevPorts = Readonly<{
	createDesignBackend: number
	createDesignFrontend: number
	createFontBackend: number
	createFontFrontend: number
}>

export function optionValue(
	argv: readonly string[],
	name: string,
): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === name) {
			const value = argv[index + 1]
			if (value === undefined || value === `--` || value.startsWith(`--`)) {
				throw new Error(`${name} requires a value.`)
			}
			return value
		}
		if (argument?.startsWith(`${name}=`)) return argument.slice(name.length + 1)
	}
	return undefined
}

export function resolveDevPort(options: {
	argv?: readonly string[]
	defaultPort: number
	environmentValue?: string
	portCount: number
}): number {
	const value =
		optionValue(options.argv ?? [], `--port`) ??
		options.environmentValue ??
		String(options.defaultPort)
	if (!/^\d+$/.test(value)) {
		throw new Error(`--port must be an integer from 1 through 65535.`)
	}
	const port = Number(value)
	const lastPort = port + options.portCount - 1
	if (!Number.isSafeInteger(port) || port < 1 || lastPort > 65_535) {
		throw new Error(
			`--port must leave room for ${options.portCount} consecutive TCP ports from 1 through 65535.`,
		)
	}
	return port
}

export function workspaceDevPorts(basePort: number): WorkspaceDevPorts {
	resolveDevPort({
		defaultPort: basePort,
		portCount: WORKSPACE_DEV_PORT_COUNT,
	})
	return {
		createFontFrontend: basePort,
		createFontBackend: basePort + 1,
		createDesignFrontend: basePort + 2,
		createDesignBackend: basePort + 3,
	}
}
