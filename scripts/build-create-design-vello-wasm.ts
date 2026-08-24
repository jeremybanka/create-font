import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url))
const outputDirectory = join(
	workspaceRoot,
	"packages",
	"create-design",
	"vello-hybrid-wasm",
	"dist",
	"web",
)
const wasmInput = join(
	workspaceRoot,
	"target",
	"wasm32-unknown-unknown",
	"release",
	"create_design_vello_wasm.wasm",
)

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
	"create-design-vello-wasm",
])
mkdirSync(outputDirectory, { recursive: true })
runMise("wasm-bindgen", [
	wasmInput,
	"--target",
	"web",
	"--typescript",
	"--out-dir",
	outputDirectory,
	"--out-name",
	"create_design_vello_wasm",
])
