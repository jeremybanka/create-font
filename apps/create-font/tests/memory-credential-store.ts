import type { CredentialStore } from "@create-art/realtime/node"

/** Synthetic test credentials never touch the developer's OS credential store. */
export function memoryCredentialStore(): CredentialStore {
	let value: string | null = null
	return {
		read: async () => value,
		write: async (next) => {
			value = next
		},
	}
}
