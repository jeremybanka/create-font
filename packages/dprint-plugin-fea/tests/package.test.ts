import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { describe, expect, test } from "vitest"

describe("dprint-plugin-fea package", () => {
	test("builds a versioned WebAssembly artifact with matching integrity", async () => {
		const packageDirectory = new URL("../", import.meta.url)
		const [bytes, manifestText, packageText] = await Promise.all([
			readFile(new URL("plugin.wasm", packageDirectory)),
			readFile(new URL("manifest.json", packageDirectory), "utf8"),
			readFile(new URL("package.json", packageDirectory), "utf8"),
		])
		const manifest = JSON.parse(manifestText) as {
			schemaVersion: number
			name: string
			version: string
			size: number
			sha256: string
		}
		const packageManifest = JSON.parse(packageText) as {
			name: string
			version: string
		}

		expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]))
		expect(manifest).toEqual({
			schemaVersion: 1,
			name: packageManifest.name,
			version: packageManifest.version,
			size: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		})
	})
})
