import { execFile } from "node:child_process"

/** Credential providers are privileged dependencies, never configuration data. */
export interface CredentialStore {
	read(): Promise<string | null>
	write(secret: string): Promise<void>
}

const SERVICE = `org.create-art.device-identity`
const ACCOUNT = `ed25519-v2`
const PROVIDER_ERROR = `The system credential store is unavailable or locked. Unlock macOS Keychain or Windows Credential Manager. On Linux, install libsecret's secret-tool and provide an unlocked, password-protected persistent Secret Service collection on the current D-Bus session. See the create-font README, "Headless Linux credentials". No configuration-file or in-memory fallback is used.`

/** Discard native errors: provider diagnostics can contain credential material. */
export function credentialStoreError(): Error {
	return new Error(PROVIDER_ERROR)
}

type ToolResult = Readonly<{
	code: number | string | null
	failed: boolean
	stdout: string
	stderr: string
}>

export function runSecretTool(
	args: readonly string[],
	secret?: string,
): Promise<ToolResult> {
	return new Promise((resolve) => {
		const child = execFile(
			`secret-tool`,
			[...args],
			{
				encoding: `utf8`,
				timeout: 15_000,
				maxBuffer: 16_384,
				// Never allow libsecret's alternate file/portal backend selection.
				env: { ...process.env, SECRET_BACKEND: `service` },
			},
			(error, stdout, stderr) => {
				resolve({
					code: error?.code ?? null,
					failed: error !== null,
					stdout,
					stderr,
				})
			},
		)
		// Passwords go only over a private pipe, never argv, environment or files.
		child.stdin?.on(`error`, () => undefined)
		child.stdin?.end(secret)
	})
}

export function createSecretServiceCredentialStore(
	run: typeof runSecretTool = runSecretTool,
): CredentialStore {
	const attributes = [`service`, SERVICE, `account`, ACCOUNT]
	return {
		async read() {
			const result = await run([`lookup`, ...attributes])
			// libsecret prints operational failures to stderr. Only an empty,
			// diagnostic-free exit 1 denotes an absent credential.
			if (
				result.failed &&
				result.code === 1 &&
				result.stderr === `` &&
				result.stdout === ``
			) {
				// A dismissed unlock prompt can also produce no lookup value.
				// Search includes locked items; only no matching items means absent.
				const matches = await run([`search`, `--all`, ...attributes])
				if (matches.failed || matches.stderr !== `` || matches.stdout !== ``) {
					throw credentialStoreError()
				}
				return null
			}
			if (result.failed || result.stderr !== ``) throw credentialStoreError()
			return result.stdout
		},
		async write(secret) {
			const result = await run(
				[
					`store`,
					`--label=Create-art device signing identity`,
					`--collection=default`,
					...attributes,
				],
				secret,
			)
			if (result.failed || result.stderr !== ``) throw credentialStoreError()
		},
	}
}

export async function createSystemCredentialStore(): Promise<CredentialStore> {
	// @napi-rs/keyring 2.0.0 silently falls back to volatile keyutils on Linux.
	// libsecret binds directly to Secret Service and cannot take that fallback.
	if (process.platform === `linux`) return createSecretServiceCredentialStore()
	if (process.platform !== `darwin` && process.platform !== `win32`) {
		throw new Error(
			`This platform has no supported persistent credential provider.`,
		)
	}
	try {
		const { AsyncEntry } = await import(`@napi-rs/keyring`)
		const entry = new AsyncEntry(SERVICE, ACCOUNT)
		return {
			async read() {
				try {
					return (await entry.getPassword()) ?? null
				} catch {
					throw credentialStoreError()
				}
			},
			async write(secret) {
				try {
					await entry.setPassword(secret)
				} catch {
					throw credentialStoreError()
				}
			},
		}
	} catch {
		throw credentialStoreError()
	}
}
