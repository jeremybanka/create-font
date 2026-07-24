import {
	copyFileSync,
	chmodSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url))
const targetDirectory = join(
	workspaceRoot,
	"target",
	"wasm32-unknown-unknown",
	"release",
)
const packageDirectory = join(workspaceRoot, "packages", "fea-wasm")
const distributionDirectory = join(packageDirectory, "dist")
const pluginDirectory = join(workspaceRoot, "plugins")
const bindingsName = "create_font_fea_wasm"

function runMise(tool: string, arguments_: string[]): void {
	execFileSync("mise", ["exec", "--", tool, ...arguments_], {
		cwd: workspaceRoot,
		stdio: "inherit",
	})
}

runMise("cargo", [
	"build",
	"--locked",
	"--release",
	"--target",
	"wasm32-unknown-unknown",
	"-p",
	"create-font-fea-wasm",
	"-p",
	"dprint-plugin-fea",
])

const bindingsInput = join(targetDirectory, `${bindingsName}.wasm`)
for (const target of ["web", "nodejs"] as const) {
	const outputName = target === "nodejs" ? "node" : target
	const outputDirectory = join(distributionDirectory, outputName)
	mkdirSync(outputDirectory, { recursive: true })
	runMise("wasm-bindgen", [
		bindingsInput,
		"--target",
		target,
		"--typescript",
		"--out-dir",
		outputDirectory,
		"--out-name",
		bindingsName,
	])
}
writeFileSync(
	join(distributionDirectory, "node", "package.json"),
	'{\n\t"type": "commonjs"\n}\n',
)
const runtimeTargets = Object.fromEntries(
	["node", "web"].map((target) => {
		const bytes = readFileSync(
			join(distributionDirectory, target, `${bindingsName}_bg.wasm`),
		)
		return [
			target,
			{
				sha256: createHash("sha256").update(bytes).digest("hex"),
				size: bytes.byteLength,
			},
		]
	}),
)
writeFileSync(
	join(distributionDirectory, "create-font-fea-wasm.json"),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			abiVersion: 1,
			name: "create-font-fea-wasm",
			version: "0.1.0",
			targets: runtimeTargets,
		},
		null,
		"\t",
	)}\n`,
)

const pluginInput = join(targetDirectory, "dprint_plugin_fea.wasm")
const pluginBytes = readFileSync(pluginInput)
const pluginHash = createHash("sha256").update(pluginBytes).digest("hex")
const pluginManifest = {
	schemaVersion: 1,
	name: "dprint-plugin-fea",
	version: "0.1.0",
	sha256: pluginHash,
	size: pluginBytes.byteLength,
}
const pluginManifestText = `${JSON.stringify(pluginManifest, null, "\t")}\n`

mkdirSync(pluginDirectory, { recursive: true })
copyFileSync(pluginInput, join(pluginDirectory, "dprint-plugin-fea.wasm"))
chmodSync(join(pluginDirectory, "dprint-plugin-fea.wasm"), 0o644)
writeFileSync(
	join(pluginDirectory, "dprint-plugin-fea.json"),
	pluginManifestText,
)
chmodSync(join(pluginDirectory, "dprint-plugin-fea.json"), 0o644)
copyFileSync(pluginInput, join(distributionDirectory, "dprint-plugin-fea.wasm"))
chmodSync(join(distributionDirectory, "dprint-plugin-fea.wasm"), 0o644)
writeFileSync(
	join(distributionDirectory, "dprint-plugin-fea.json"),
	pluginManifestText,
)
