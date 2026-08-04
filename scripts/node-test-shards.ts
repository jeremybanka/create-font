import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

type PackageManifest = Readonly<{
	name: string
	scripts?: Readonly<Record<string, string>>
}>

type PackageTests = Readonly<{
	kind: `package-tests`
	packages: readonly string[]
}>

type PackageScript = Readonly<{
	kind: `package-script`
	package: string
	script: string
}>

type WorkspaceCommand = Readonly<{
	arguments: readonly string[]
	command: string
	kind: `workspace-command`
	surface: `workspace:cargo-tests` | `workspace:development-ports`
}>

type ShardCommand = PackageTests | PackageScript | WorkspaceCommand

const workspaceRoot = fileURLToPath(new URL(`..`, import.meta.url))

const shards = {
	"create-font-interfaces": [
		{
			kind: `package-script`,
			package: `create-font`,
			script: `test:unit-interfaces`,
		},
	],
	"create-font-source-pipeline": [
		{
			kind: `package-script`,
			package: `create-font`,
			script: `test:unit-source-pipeline`,
		},
	],
	"design-application": [
		{ kind: `package-tests`, packages: [`create-design`] },
	],
	"feature-syntax-core": [
		{
			arguments: [`exec`, `--`, `cargo`, `test`, `--workspace`],
			command: `mise`,
			kind: `workspace-command`,
			surface: `workspace:cargo-tests`,
		},
	],
	"filesystem-integration": [
		{
			kind: `package-script`,
			package: `create-font`,
			script: `test:e2e`,
		},
		{
			kind: `package-script`,
			package: `create-font`,
			script: `test:node-server`,
		},
	],
	"shared-foundations": [
		{
			arguments: [`--test`, `./scripts/dev-ports.test.ts`],
			command: `node`,
			kind: `workspace-command`,
			surface: `workspace:development-ports`,
		},
		{
			kind: `package-tests`,
			packages: [
				`@create-art/editor`,
				`@create-art/source-rpc`,
				`@create-art/vector-geometry`,
				`@create-design/model`,
				`@create-design/pdf`,
				`@create-design/png`,
				`@create-design/svg`,
				`@create-design/text`,
				`@create-font/font-service`,
				`@create-font/server`,
				`@create-font/target`,
			],
		},
	],
	"source-formats": [
		{
			kind: `package-tests`,
			packages: [
				`@create-art/source-format`,
				`@create-design/source`,
				`@create-font/fea-rs-wasm`,
				`@create-font/source`,
				`dprint-plugin-fea`,
			],
		},
	],
	editor: [
		{
			kind: `package-tests`,
			packages: [`@create-design/editor`],
		},
		{
			kind: `package-script`,
			package: `@create-font/editor`,
			script: `test:coverage`,
		},
	],
	"state-model": [{ kind: `package-tests`, packages: [`@create-font/states`] }],
} as const satisfies Readonly<Record<string, readonly ShardCommand[]>>

type ShardName = keyof typeof shards

function packageManifests(): Map<string, PackageManifest> {
	const manifests = new Map<string, PackageManifest>()
	const visit = (directory: string): void => {
		const entries = readdirSync(directory, { withFileTypes: true })
		const manifestEntry = entries.find(
			(entry) => entry.isFile() && entry.name === `package.json`,
		)
		if (manifestEntry === undefined) {
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name === `node_modules`) continue
				visit(join(directory, entry.name))
			}
			return
		}
		const manifest = JSON.parse(
			readFileSync(join(directory, manifestEntry.name), `utf8`),
		) as PackageManifest
		if (manifests.has(manifest.name)) {
			throw new Error(`Duplicate workspace package name ${manifest.name}.`)
		}
		manifests.set(manifest.name, manifest)
	}
	for (const root of [`apps`, `packages`]) {
		visit(join(workspaceRoot, root))
	}
	return manifests
}

function verifyShards(): void {
	const manifests = packageManifests()
	const actualSurfaces = new Map<string, string[]>()
	const record = (surface: string, shard: string): void => {
		actualSurfaces.set(surface, [...(actualSurfaces.get(surface) ?? []), shard])
	}

	for (const [shard, commands] of Object.entries(shards)) {
		for (const command of commands) {
			if (command.kind === `workspace-command`) {
				record(command.surface, shard)
				continue
			}
			const packageScripts =
				command.kind === `package-tests`
					? command.packages.map(
							(packageName) => [packageName, `test`] as const,
						)
					: [[command.package, command.script] as const]
			for (const [packageName, script] of packageScripts) {
				const manifest = manifests.get(packageName)
				if (manifest === undefined) {
					throw new Error(`${shard} references unknown package ${packageName}.`)
				}
				if (manifest.scripts?.[script] === undefined) {
					throw new Error(
						`${packageName} has no ${script} script for ${shard}.`,
					)
				}
				record(`${packageName}:${script}`, shard)
			}
		}
	}

	const expectedSurfaces = new Set([
		`workspace:cargo-tests`,
		`workspace:development-ports`,
	])
	for (const manifest of manifests.values()) {
		if (manifest.scripts?.test === undefined) continue
		if (manifest.name === `create-font`) {
			for (const script of [
				`test:unit-interfaces`,
				`test:unit-source-pipeline`,
				`test:e2e`,
				`test:node-server`,
			]) {
				expectedSurfaces.add(`${manifest.name}:${script}`)
			}
			continue
		}
		if (manifest.name === `@create-font/editor`) {
			// Coverage executes the complete editor suite, so do not run it twice.
			expectedSurfaces.add(`${manifest.name}:test:coverage`)
			continue
		}
		expectedSurfaces.add(`${manifest.name}:test`)
	}

	const errors: string[] = []
	for (const surface of expectedSurfaces) {
		const owners = actualSurfaces.get(surface) ?? []
		if (owners.length === 0)
			errors.push(`${surface} is not assigned to a shard.`)
		if (owners.length > 1) {
			errors.push(
				`${surface} is assigned more than once: ${owners.join(`, `)}.`,
			)
		}
	}
	for (const [surface, owners] of actualSurfaces) {
		if (!expectedSurfaces.has(surface)) {
			errors.push(
				`${surface} is assigned to ${owners.join(`, `)} but is not expected.`,
			)
		}
	}
	if (errors.length > 0) throw new Error(errors.toSorted().join(`\n`))
}

function run(command: string, arguments_: readonly string[]): void {
	const result = spawnSync(command, arguments_, {
		cwd: workspaceRoot,
		stdio: `inherit`,
	})
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) {
		throw new Error(
			`${command} ${arguments_.join(` `)} exited ${result.status}.`,
		)
	}
}

function runShard(shard: ShardName): void {
	for (const command of shards[shard]) {
		if (command.kind === `workspace-command`) {
			run(command.command, command.arguments)
			continue
		}
		if (command.kind === `package-script`) {
			run(`pnpm`, [`--filter`, command.package, command.script])
			continue
		}
		run(`pnpm`, [
			...command.packages.flatMap((packageName) => [`--filter`, packageName]),
			`test`,
		])
	}
}

verifyShards()
const requested = process.argv[2] ?? `verify`
if (requested !== `verify`) {
	if (!(requested in shards)) {
		throw new Error(
			`Unknown Node test shard ${requested}. Expected one of ${Object.keys(shards).join(`, `)}.`,
		)
	}
	runShard(requested as ShardName)
}
