const TYPESCRIPT_FOR_LEGACY_TOOLING = "6.0.3"

// A few tools still read the TypeScript 6 compiler API that TypeScript 7 no
// longer exposes in the same shape. Keep their compiler private so the
// workspace itself remains checked by TypeScript 7. Remove entries as those
// tools gain native TypeScript 7 support.
const TYPESCRIPT_6_CONSUMERS = new Set([
	"@typescript-eslint/parser",
	"@typescript-eslint/typescript-estree",
	"@voidzero-dev/vite-plus-core",
])

const needsTypescript6 = (packageJson) =>
	TYPESCRIPT_6_CONSUMERS.has(packageJson.name) &&
	packageJson.peerDependencies?.typescript !== undefined

// The state-engine entrypoint is framework-neutral. Its React adapter lives at
// atom.io/react, which this workspace does not consume, so do not auto-install
// React merely to satisfy that optional adapter peer.
const omitUnusedReactAdapter = (packageJson) => packageJson.name === "atom.io"

export const hooks = {
	readPackage(packageJson) {
		if (omitUnusedReactAdapter(packageJson)) {
			delete packageJson.peerDependencies?.react
			delete packageJson.peerDependenciesMeta?.react
		}

		if (needsTypescript6(packageJson)) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: TYPESCRIPT_FOR_LEGACY_TOOLING,
			}
		}

		return packageJson
	},
}
