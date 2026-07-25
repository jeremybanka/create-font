import {
	CREATE_FONT_FEA_RESTART_COMMAND,
	CREATE_FONT_FEA_SETTINGS,
} from "./fea-vscode-manifest.ts"

declare const require: (id: string) => unknown

type Disposable = { dispose(): void }
type ExtensionContext = {
	asAbsolutePath(path: string): string
	subscriptions: { push(...disposables: Disposable[]): void }
}
type Vscode = {
	commands: {
		registerCommand(command: string, callback: () => unknown): Disposable
	}
	workspace: {
		createFileSystemWatcher(pattern: string): unknown
		getConfiguration(section: string): {
			get<T>(key: string, fallback: T): T
		}
		workspaceFolders?: readonly { readonly uri: { readonly fsPath: string } }[]
	}
}

const path = require(`node:path`) as typeof import("node:path")
const vscode = require(`vscode`) as Vscode
const { LanguageClient, TransportKind } = require(
	`vscode-languageclient/node`,
) as typeof import("vscode-languageclient/node")

let client: InstanceType<typeof LanguageClient> | undefined

function resolveConfiguredPath(value: string, workspaceRoot?: string): string {
	const trimmed = value.trim()
	if (!trimmed || path.isAbsolute(trimmed) || !workspaceRoot) return trimmed
	return path.resolve(workspaceRoot, trimmed)
}

async function start(context: ExtensionContext): Promise<void> {
	const configuration = vscode.workspace.getConfiguration(`createFont.features`)
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	const executable = resolveConfiguredPath(
		configuration.get(`executablePath`, ``),
		workspaceRoot,
	)
	const configuredModule = resolveConfiguredPath(
		configuration.get(`modulePath`, ``),
		workspaceRoot,
	)
	const environment = {
		...process.env,
		CREATE_FONT_FEA_LOG_LEVEL: configuration.get(`logLevel`, `info`),
	}
	const serverOptions = executable
		? {
				args: [`--stdio`],
				command: executable,
				options: { env: environment },
			}
		: {
				args: [`--stdio`],
				module: configuredModule || context.asAbsolutePath(`dist/server.mjs`),
				options: { env: environment },
				transport: TransportKind.stdio,
			}
	const watchers = [
		`**/features/**/*.fea`,
		`**/features/index.json`,
		`**/glyphs/**/*.json`,
		`**/create-font.json`,
	].map((pattern) => vscode.workspace.createFileSystemWatcher(pattern))
	client = new LanguageClient(
		`createFont.features`,
		`Create Font Feature Language Server`,
		serverOptions,
		{
			documentSelector: [{ language: `fea`, scheme: `file` }],
			synchronize: { fileEvents: watchers },
		},
	)
	await client.start()
}

export async function activate(context: ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			CREATE_FONT_FEA_RESTART_COMMAND,
			async () => {
				await client?.stop()
				client = undefined
				await start(context)
			},
		),
	)
	await start(context)
}

export async function deactivate(): Promise<void> {
	await client?.stop()
	client = undefined
}

export { CREATE_FONT_FEA_SETTINGS, resolveConfiguredPath }
