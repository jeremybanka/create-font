import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url))
const packageDirectory = join(workspaceRoot, "packages", "dprint-plugin-fea")
const packageManifest = JSON.parse(
	readFileSync(join(packageDirectory, "package.json"), "utf8"),
) as { name: string; version: string }

execFileSync(
	"mise",
	[
		"exec",
		"--",
		"cargo",
		"build",
		"--locked",
		"--release",
		"--target",
		"wasm32-unknown-unknown",
		"-p",
		"dprint-plugin-fea",
	],
	{ cwd: workspaceRoot, stdio: "inherit" },
)

const pluginInput = join(
	workspaceRoot,
	"target",
	"wasm32-unknown-unknown",
	"release",
	"dprint_plugin_fea.wasm",
)
const pluginOutput = join(packageDirectory, "plugin.wasm")
const bytes = readFileSync(pluginInput)
copyFileSync(pluginInput, pluginOutput)
chmodSync(pluginOutput, 0o644)
writeFileSync(
	join(packageDirectory, "manifest.json"),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			name: packageManifest.name,
			version: packageManifest.version,
			size: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		},
		null,
		"\t",
	)}\n`,
)
