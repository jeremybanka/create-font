import type { CredentialStore } from "../src/credential-store.ts"

export function memoryCredentialStore(): CredentialStore {
	let value: string | null = null
	return {
		read: async () => value,
		write: async (next) => {
			value = next
		},
	}
}
