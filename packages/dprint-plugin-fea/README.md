# `dprint-plugin-fea`

A dprint plugin for Adobe Feature Files (`.fea`), backed by the lossless
`fea-rs` parser and create-font formatter.

## Installation

```sh
pnpm add --save-dev dprint-plugin-fea
```

Reference the package artifact from `dprint.json`:

```json
{
	"fea": {
		"associations": ["**/*.fea"],
		"lineWidth": 80,
		"indentWidth": 2,
		"useTabs": false,
		"newLineKind": "auto"
	},
	"plugins": ["./node_modules/dprint-plugin-fea/plugin.wasm"]
}
```

The plugin preserves every non-whitespace source token in order, including the
exact text of leading, block, inline, and trailing comments. It retains one
intentional blank line and produces canonical blocks, statements, classes,
records, contextual rules, tables, and include directives. Syntax errors stop
formatting before any output is returned.

Supported configuration:

- `lineWidth` (default `80`);
- `indentWidth` (default `2`);
- `useTabs` (default `false`);
- `newLineKind`: `"auto"`, `"lf"`, or `"crlf"`.

## Development

The repository does not check in `plugin.wasm`. Build it reproducibly with the
mise-managed Rust toolchain:

```sh
mise install
pnpm exec vp run dprint-plugin-fea#build
pnpm --filter dprint-plugin-fea test
pnpm --filter dprint-plugin-fea pack --dry-run
```

The build writes the ignored `plugin.wasm` and `manifest.json` package
artifacts. `manifest.json` records the package version, byte size, and SHA-256
digest included in the npm tarball.
