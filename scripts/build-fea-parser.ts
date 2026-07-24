import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
const packageDirectory = join(workspaceRoot, "packages", "fea-parser")
const distributionDirectory = join(packageDirectory, "dist")
const bindingsName = "create_font_fea_parser"
const packageManifest = JSON.parse(
	readFileSync(join(packageDirectory, "package.json"), "utf8"),
) as { name: string; version: string }

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
	"create-font-fea-parser",
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
	join(distributionDirectory, "create-font-fea-parser.json"),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			abiVersion: 1,
			name: packageManifest.name,
			version: packageManifest.version,
			targets: runtimeTargets,
		},
		null,
		"\t",
	)}\n`,
)
