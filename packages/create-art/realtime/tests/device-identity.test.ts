// @vitest-environment node
import {
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspect } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
	createSecretServiceCredentialStore,
	type CredentialStore,
} from "../src/credential-store.ts"
import {
	readOrCreateDeviceIdentity,
	rotateDeviceIdentity,
} from "../src/device-identity.ts"
import { verifyIdentityClaim } from "../src/node.ts"
import { memoryCredentialStore } from "./memory-credential-store.ts"

const profile = { name: `Ada`, email: `ada@example.test` }
const directories: string[] = []
async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), `create-art-credential-test-`))
	directories.push(directory)
	return directory
}
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

describe(`credential-backed signing identity`, () => {
	it(`rejects non-public profile values before reading credentials`, async () => {
		const store = { read: vi.fn(), write: vi.fn() }
		for (const operation of [
			readOrCreateDeviceIdentity,
			rotateDeviceIdentity,
		]) {
			await expect(
				operation({
					...profile,
					name: { secret: `SYNTHETIC_NESTED_SECRET` } as unknown as string,
					credentialStore: store,
				}),
			).rejects.toThrow(`name and email`)
		}
		expect(store.read).not.toHaveBeenCalled()
		expect(store.write).not.toHaveBeenCalled()
	})

	it(`persists only through the provider and publishes no private material`, async () => {
		const directory = await temporaryDirectory()
		const store = memoryCredentialStore()
		const options = {
			...profile,
			credentialStore: store,
			legacyPath: join(directory, `identity.json`),
		}
		const first = await readOrCreateDeviceIdentity(options)
		const secret = await store.read()
		expect(secret).toContain(`PRIVATE KEY`)
		const second = await readOrCreateDeviceIdentity({
			...options,
			name: `Ada Lovelace`,
		})
		expect(second.publicIdentity.deviceId).toBe(first.publicIdentity.deviceId)
		expect(second.publicIdentity.name).toBe(`Ada Lovelace`)
		expect(await readdir(directory)).toEqual([])
		const claim = first.signClaim({
			audience: `a`.repeat(32),
			nonce: `challenge`,
		})
		expect(verifyIdentityClaim(claim)).toBe(true)
		for (const serialized of [
			JSON.stringify(first),
			JSON.stringify({ ...first }),
			inspect(first, { showHidden: true }),
			JSON.stringify(claim),
		]) {
			expect(serialized).not.toContain(`PRIVATE KEY`)
			expect(serialized).not.toContain(secret)
		}
	})

	it(`captures public profile fields before awaiting a credential provider`, async () => {
		const store = memoryCredentialStore()
		const options = { ...profile, credentialStore: store }
		const identity = readOrCreateDeviceIdentity(options)
		options.name = { secret: `SYNTHETIC_LATE_SECRET` } as unknown as string
		expect((await identity).publicIdentity.name).toBe(profile.name)
	})

	it(`does not replace a locked, failed or invalid credential`, async () => {
		const write = vi.fn()
		const failed: CredentialStore = {
			read: async () => {
				throw new Error(`SYNTHETIC_SECRET_MARKER`)
			},
			write,
		}
		await expect(
			readOrCreateDeviceIdentity({ ...profile, credentialStore: failed }),
		).rejects.toThrow(`unavailable or locked`)
		try {
			await rotateDeviceIdentity({ ...profile, credentialStore: failed })
		} catch (error) {
			expect(inspect(error, { showHidden: true })).not.toContain(
				`SYNTHETIC_SECRET_MARKER`,
			)
		}
		expect(write).not.toHaveBeenCalled()
		await expect(
			readOrCreateDeviceIdentity({
				...profile,
				credentialStore: { read: async () => `SYNTHETIC_INVALID_KEY`, write },
			}),
		).rejects.toThrow(`credential is invalid`)
		expect(write).not.toHaveBeenCalled()
	})

	it(`blocks legacy configuration and explicitly rotates before removing it`, async () => {
		const directory = await temporaryDirectory()
		const legacyPath = join(directory, `identity.json`)
		const legacy = `{"privateKey":"SYNTHETIC_LEGACY_SECRET"}`
		await writeFile(legacyPath, legacy)
		const store = memoryCredentialStore()
		const prior = await readOrCreateDeviceIdentity({
			...profile,
			credentialStore: store,
		})
		const options = { ...profile, credentialStore: store, legacyPath }
		await expect(readOrCreateDeviceIdentity(options)).rejects.toThrow(
			`font identity rotate`,
		)
		expect(await readFile(legacyPath, `utf8`)).toBe(legacy)
		const rotated = await rotateDeviceIdentity(options)
		expect(rotated.publicIdentity.deviceId).not.toBe(
			prior.publicIdentity.deviceId,
		)
		expect(await readdir(directory)).toEqual([])
		expect((await readOrCreateDeviceIdentity(options)).publicIdentity).toEqual(
			rotated.publicIdentity,
		)
	})

	it(`keeps the legacy file when writing or verifying the provider fails`, async () => {
		const legacyPath = join(await temporaryDirectory(), `identity.json`)
		await writeFile(legacyPath, `SYNTHETIC_LEGACY_SECRET`)
		for (const store of [
			{
				read: async () => null,
				write: async () => {
					throw new Error(`SYNTHETIC_PROVIDER_SECRET`)
				},
			},
			{ read: async () => null, write: async () => undefined },
		]) {
			await expect(
				rotateDeviceIdentity({
					...profile,
					legacyPath,
					credentialStore: store,
				}),
			).rejects.toThrow(`credential store`)
			expect(await readFile(legacyPath, `utf8`)).toBe(`SYNTHETIC_LEGACY_SECRET`)
		}
	})

	it(`refuses legacy symlinks before accessing the provider`, async () => {
		const directory = await temporaryDirectory()
		const target = join(directory, `unrelated.txt`)
		const legacyPath = join(directory, `identity.json`)
		await writeFile(target, `untouched`)
		await symlink(target, legacyPath)
		const read = vi.fn()
		await expect(
			rotateDeviceIdentity({
				...profile,
				legacyPath,
				credentialStore: { read, write: vi.fn() },
			}),
		).rejects.toThrow(`safely inspected`)
		expect(read).not.toHaveBeenCalled()
		expect(await readFile(target, `utf8`)).toBe(`untouched`)
	})
})

describe(`explicit Linux Secret Service provider`, () => {
	const absent = { code: 1, failed: true, stdout: ``, stderr: `` }
	const empty = { code: null, failed: false, stdout: ``, stderr: `` }
	it(`distinguishes absent credentials from locked entries and provider failures`, async () => {
		const missing = vi
			.fn()
			.mockResolvedValueOnce(absent)
			.mockResolvedValueOnce(empty)
		expect(await createSecretServiceCredentialStore(missing).read()).toBeNull()
		for (const result of [
			{ ...absent, stderr: `SYNTHETIC_SECRET_FROM_PROVIDER` },
			{ ...absent, code: `ENOENT` },
			{ ...absent, code: null },
		]) {
			await expect(
				createSecretServiceCredentialStore(
					vi.fn().mockResolvedValue(result),
				).read(),
			).rejects.toThrow(`unavailable or locked`)
		}
		const locked = vi
			.fn()
			.mockResolvedValueOnce(absent)
			.mockResolvedValueOnce({ ...empty, stdout: `[locked-item]\n` })
		await expect(
			createSecretServiceCredentialStore(locked).read(),
		).rejects.toThrow(`unavailable or locked`)
	})
	it(`uses the persistent collection and passes secrets separately from command arguments`, async () => {
		const run = vi.fn().mockResolvedValue(empty)
		await createSecretServiceCredentialStore(run).write(`SYNTHETIC_PIPE_SECRET`)
		expect(run.mock.calls[0]?.[0]).toContain(`--collection=default`)
		expect(run.mock.calls[0]?.[0]).not.toContain(`SYNTHETIC_PIPE_SECRET`)
		expect(run.mock.calls[0]?.[1]).toBe(`SYNTHETIC_PIPE_SECRET`)
	})
})
