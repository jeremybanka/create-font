# `@create-font/fea-wasm`

Rust-powered Adobe Feature File (`.fea`) syntax and formatting for Node,
browsers, and dprint.

The package ships only WebAssembly runtimes. Its shared Rust core uses
[`fea-rs`](https://github.com/googlefonts/fontc/tree/main/fea-rs) for the Adobe
feature grammar and exposes:

- a recoverable, source-located, lossless syntax tree;
- exact whitespace, comment, and token preservation;
- deterministic, idempotent formatting;
- a schema-v4 dprint Wasm plugin;
- generated `wasm-bindgen` entry points for browsers and Node.

## JavaScript API

Use the browser entry point and initialize it before calling the synchronous
exports:

```ts
import init, { formatFea, parseFea } from "@create-font/fea-wasm/web"

await init()
const syntax = JSON.parse(parseFea("feature liga { sub f i by f_i; } liga;"))
const formatted = formatFea(
	"feature liga{sub f i by f_i;}liga;",
	JSON.stringify({ lineWidth: 100 }),
)
```

The Node entry point initializes itself:

```ts
import { formatFea, parseFea } from "@create-font/fea-wasm/node"
```

`parseFea` returns JSON with `abiVersion`, `sourceLen`, a recursive `root`, and
recoverable `diagnostics`. Every node and token has a half-open UTF-8 byte
range. Tokens include their exact source text, including whitespace and
comments, so concatenating the token text reconstructs the input byte for byte.
Node `kind` values are the stable typed projection used for traversal; each
node exposes ordered `children`, while tokens expose exact `text`.

ABI version `1` uses owned JavaScript strings on both sides of each call. The
generated `wasm-bindgen` module owns its linear memory, and the Rust API keeps
no document handles, cached trees, or source text after a call returns.
Consequently there is no consumer disposal step and repeated parses cannot
retain stale documents. A breaking JSON shape, diagnostic code, or ownership
change requires an ABI version bump.

Includes are intentionally not loaded by the Wasm boundary. An
`include(path.fea)` statement remains a normal lossless syntax node; the host
owns filesystem or network resolution.

`formatFea` accepts JSON with these properties:

- `lineWidth` (default `80`);
- `indentWidth` (default `2`);
- `useTabs` (default `false`);
- `newLineKind`: `"auto"`, `"lineFeed"`, or `"carriageReturnLineFeed"`.

Formatting is fail-closed. If parsing reports an error, no rewritten text is
returned.

## Syntax coverage and deviations

Parsing follows the Adobe Feature File grammar implemented by `fea-rs` 0.22,
including GSUB and GPOS rules, named lookups, glyph classes, value records,
feature variations, and the supported Adobe table blocks. The repository
fixture exercises languagesystems, classes, includes, lookup blocks,
substitution, contextual rules, positioning, value records, and GDEF.

This module intentionally performs syntax parsing only. Project-aware include
loading, glyph inventory checks, lookup validation, and create-font semantic
lowering belong to the host analysis layer. Diagnostics have stable
`fea.syntax.*` codes and byte ranges; their explanatory text follows the pinned
`fea-rs` release. Future upstream node kinds remain visible as lossless nodes
instead of being discarded.

## dprint

The package exports `./dprint-plugin.wasm` and its checksum metadata at
`./dprint-plugin.json`. This repository checks in the same reproducible plugin
at `plugins/dprint-plugin-fea.wasm` and configures it in the root
`dprint.json`.

The dprint configuration key is `fea`; it recognizes `.fea` files and accepts
`lineWidth`, `indentWidth`, `useTabs`, and `newLineKind` (`"auto"`, `"lf"`, or
`"crlf"`).

The formatter preserves every non-whitespace source token in order, including
the exact text of leading, block, inline, and trailing comments. It retains a
single intentional blank line and produces canonical blocks, statements,
classes, records, contextual rules, tables, and include directives. Unknown
valid tokens remain in the lossless token stream; syntax errors stop formatting
before any output is returned.

## Rebuilding

Install the versions pinned by the repository and build:

```sh
mise install
pnpm --filter @create-font/fea-wasm build
```

The build uses mise-managed Cargo, Rust, the `wasm32-unknown-unknown` target,
and `wasm-bindgen-cli`. It writes package bindings under `dist/` and refreshes
the checked-in dprint plugin plus its SHA-256 manifest under `plugins/`.

Run the release checks with:

```sh
pnpm run check:rust
pnpm run build
pnpm run test
pnpm run fmt:check
pnpm --dir packages/fea-wasm pack --dry-run
```

`dist/create-font-fea-wasm.json` records the ABI version, byte size, and
SHA-256 of both runtime Wasm files. `dist/dprint-plugin-fea.json` and the
checked-in `plugins/dprint-plugin-fea.json` do the same for the dprint plugin.
The workspace release command rebuilds these files before Changesets publishes
the package.

## Reference size and performance

Release artifacts built with Rust 1.97.1 are 278,359 bytes for the parser and
formatter runtime and 377,713 bytes for the dprint plugin. A reference run on
Node 26.5.0 measured:

| Operation        |        Input |    Mean |
| ---------------- | -----------: | ------: |
| Cold module load |            — | 1.52 ms |
| Parse            |    635 bytes | 0.35 ms |
| Format           |    635 bytes | 0.14 ms |
| Parse            | 15,875 bytes | 6.54 ms |
| Format           | 15,875 bytes | 2.43 ms |

These are development-machine reference values, not performance guarantees.
Regenerate comparable measurements after a build with:

```sh
pnpm --filter @create-font/fea-wasm benchmark
```
