# `@create-font/fea-parser`

Rust-powered Adobe Feature File (`.fea`) parsing and formatting for Node and
browsers.

The package uses
[`fea-rs`](https://github.com/googlefonts/fontc/tree/main/fea-rs) for the Adobe
feature grammar and exposes:

- a recoverable, source-located, lossless syntax tree;
- exact whitespace, comment, and token preservation;
- deterministic, idempotent formatting;
- generated entry points for browsers and Node.

The runtime happens to use WebAssembly as its portable implementation detail.
The public package is named for its parser API rather than that transport.

## JavaScript API

Use the browser entry point and initialize it before calling the synchronous
exports:

```ts
import init, { formatFea, parseFea } from "@create-font/fea-parser/web"

await init()
const syntax = JSON.parse(parseFea("feature liga { sub f i by f_i; } liga;"))
const formatted = formatFea(
	"feature liga{sub f i by f_i;}liga;",
	JSON.stringify({ lineWidth: 100 }),
)
```

The Node entry point initializes itself:

```ts
import { formatFea, parseFea } from "@create-font/fea-parser/node"
```

`parseFea` returns JSON with `abiVersion`, `sourceLen`, a recursive `root`, and
recoverable `diagnostics`. Every node and token has a half-open UTF-8 byte
range. Tokens include their exact source text, including whitespace and
comments, so concatenating the token text reconstructs the input byte for byte.

ABI version `1` uses owned JavaScript strings on both sides of each call. The
module owns its linear memory, and the Rust API keeps no document handles,
cached trees, or source text after a call returns. A breaking JSON shape,
diagnostic code, or ownership change requires an ABI version bump.

Includes are intentionally not loaded by the parser boundary. An
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
`fea-rs` release.

## Rebuilding

Install the versions pinned by the repository and build:

```sh
mise install
pnpm --filter @create-font/fea-parser build
```

The build uses mise-managed Cargo, Rust, the `wasm32-unknown-unknown` target,
and `wasm-bindgen-cli`. Generated bindings and Wasm stay under the ignored
`dist/` directory and are included only in the published package.

Run the package checks with:

```sh
pnpm --filter @create-font/fea-parser build
pnpm --filter @create-font/fea-parser test
pnpm --filter @create-font/fea-parser pack --dry-run
```

`dist/create-font-fea-parser.json` records the ABI version, byte size, and
SHA-256 of both runtime artifacts.

## Reference size and performance

A release runtime built with Rust 1.97.1 is approximately 278 kB. Regenerate
performance measurements after a build with:

```sh
pnpm --filter @create-font/fea-parser benchmark
```
