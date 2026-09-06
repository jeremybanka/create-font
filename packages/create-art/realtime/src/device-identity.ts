import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
	type KeyObject,
} from "node:crypto"
import { lstat, unlink } from "node:fs/promises"

import type { CollaborationIdentity, SignedIdentityClaim } from "./contracts.ts"
import {
	createSystemCredentialStore,
	credentialStoreError,
	type CredentialStore,
} from "./credential-store.ts"

type Challenge = Readonly<{ audience: string; nonce: string }>

/** Public data plus a signing capability; private material never escapes it. */
export interface DeviceIdentity {
	readonly publicIdentity: CollaborationIdentity
	signClaim(challenge: Challenge, issuedAt?: number): SignedIdentityClaim
}

interface IdentityOptions {
	readonly email: string
	readonly name: string
	/** Detection/removal only. This path is never read, imported or written. */
	readonly legacyPath?: string
	/** Trusted injection point for providers and isolated tests. */
	readonly credentialStore?: CredentialStore
}

function readProfile(
	options: IdentityOptions,
): Pick<IdentityOptions, `name` | `email`> {
	const { name, email } = options
	if (
		typeof name !== `string` ||
		name.length === 0 ||
		name.length > 256 ||
		typeof email !== `string` ||
		email.length === 0 ||
		email.length > 320
	) {
		throw new TypeError(
			`Device identity requires a nonempty name and email within protocol limits.`,
		)
	}
	return { name, email }
}

function identityService(
	key: KeyObject,
	options: IdentityOptions,
): DeviceIdentity {
	const publicKey = createPublicKey(key)
		.export({ format: `pem`, type: `spki` })
		.toString()
	const publicIdentity = Object.freeze({
		deviceId: createHash(`sha256`).update(publicKey).digest(`hex`).slice(0, 24),
		email: options.email,
		name: options.name,
		publicKey,
	})
	return Object.freeze({
		publicIdentity,
		signClaim(
			challenge: Challenge,
			issuedAt = Date.now(),
		): SignedIdentityClaim {
			const unsigned = {
				audience: challenge.audience,
				identity: publicIdentity,
				issuedAt,
				nonce: challenge.nonce,
			}
			return {
				...unsigned,
				signature: sign(
					null,
					Buffer.from(JSON.stringify(unsigned)),
					key,
				).toString(`base64url`),
			}
		},
	})
}

async function legacyEntry(path: string | undefined) {
	if (path === undefined) return null
	try {
		const entry = await lstat(path)
		if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
			throw new Error(
				`The legacy identity must be a regular file with no links. Remove the obsolete credential manually before retrying.`,
			)
		}
		return entry
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === `ENOENT`) return null
		throw new Error(
			`The legacy identity cannot be safely inspected. Remove the obsolete credential manually before retrying.`,
		)
	}
}

function decodeKey(value: string): KeyObject {
	try {
		const key = createPrivateKey(value)
		if (key.asymmetricKeyType !== `ed25519`) throw new Error()
		return key
	} catch {
		throw new Error(
			`The device credential is invalid. Run "font identity rotate" to replace it; no configuration fallback is used.`,
		)
	}
}

async function storedKey(store: CredentialStore): Promise<string | null> {
	try {
		return await store.read()
	} catch {
		throw credentialStoreError()
	}
}

async function writeFreshKey(store: CredentialStore): Promise<KeyObject> {
	const key = generateKeyPairSync(`ed25519`).privateKey
	const secret = key.export({ format: `pem`, type: `pkcs8` }).toString()
	try {
		await store.write(secret)
		if ((await store.read()) !== secret) throw new Error()
	} catch {
		throw credentialStoreError()
	}
	return key
}

export async function readOrCreateDeviceIdentity(
	options: IdentityOptions,
): Promise<DeviceIdentity> {
	const profile = readProfile(options)
	if ((await legacyEntry(options.legacyPath)) !== null) {
		throw new Error(
			`An obsolete device signing key remains in configuration. It may have been disclosed by earlier multiplayer versions. Run "font identity rotate" to generate a new key in the system credential store and remove the old file.`,
		)
	}
	const store = options.credentialStore ?? (await createSystemCredentialStore())
	const secret = await storedKey(store)
	const key = secret === null ? await writeFreshKey(store) : decodeKey(secret)
	return identityService(key, profile)
}

/** Explicit recovery: never import or retain a potentially disclosed old key. */
export async function rotateDeviceIdentity(
	options: IdentityOptions,
): Promise<DeviceIdentity> {
	const profile = readProfile(options)
	const legacy = await legacyEntry(options.legacyPath)
	const store = options.credentialStore ?? (await createSystemCredentialStore())
	// Read first to prove accessibility; a locked store is never missing state.
	await storedKey(store)
	const key = await writeFreshKey(store)
	if (legacy !== null && options.legacyPath !== undefined) {
		const current = await legacyEntry(options.legacyPath)
		if (
			current === null ||
			current.dev !== legacy.dev ||
			current.ino !== legacy.ino
		) {
			throw new Error(
				`The legacy identity changed during rotation. The new key is in the credential store; remove the obsolete configuration credential manually before retrying.`,
			)
		}
		try {
			await unlink(options.legacyPath)
		} catch {
			throw new Error(
				`The new key is in the credential store, but the obsolete configuration credential could not be removed. Remove it manually before retrying.`,
			)
		}
	}
	return identityService(key, profile)
}

export function signIdentityClaim(
	identity: DeviceIdentity,
	challenge: Challenge,
	issuedAt = Date.now(),
): SignedIdentityClaim {
	return identity.signClaim(challenge, issuedAt)
}
