import { access } from "node:fs/promises"
import { basename, resolve } from "node:path"

async function hasApplicationIndex(root: string): Promise<boolean> {
	return access(resolve(root, "index.html")).then(
		() => true,
		() => false,
	)
}

/**
 * Resolve the prebuilt browser application served by the workspace server.
 *
 * Source execution normally uses the development bundle, but installed
 * packages can resolve the TypeScript source through custom export conditions
 * while only containing the production bundle. Keep that case functional and
 * never let the browser server silently mount an empty directory.
 */
export async function resolveApplicationAssets(
	moduleDirectory: string,
): Promise<string> {
	const bundled = basename(moduleDirectory) === "dist"
	const candidates = bundled
		? [resolve(moduleDirectory, "public")]
		: [
				resolve(moduleDirectory, "../dist/dev/public"),
				resolve(moduleDirectory, "../dist/public"),
			]

	for (const candidate of candidates) {
		if (await hasApplicationIndex(candidate)) return candidate
	}

	throw new Error(
		`create-font browser assets are missing. Expected index.html in ${candidates.join(
			" or ",
		)}. Build create-font before starting font dev; in the repository, run pnpm --filter create-font dev.`,
	)
}
