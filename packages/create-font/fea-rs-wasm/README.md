# `@create-font/fea-rs-wasm`

WebAssembly bindings for
[`fea-rs`](https://github.com/googlefonts/fontc/tree/main/fea-rs) and the
create-font Adobe Feature File (`.fea`) formatter, packaged for Node and
browsers.

`fea-rs` owns the Adobe feature grammar, parser, error recovery, and lossless
concrete syntax tree. This package does not implement a separate parser or AST.
It provides:

- a versioned JSON projection of the `fea-rs` concrete syntax tree and
  diagnostics;
- generated WebAssembly entry points for browsers and Node;
- the create-font deterministic, idempotent formatter.

## JavaScript API

Use the browser entry point and initialize it before calling the synchronous
exports:

```ts
import init, { formatFea, parseFea } from "@create-font/fea-rs-wasm/web"

await init()
const syntax = JSON.parse(parseFea("feature liga { sub f i by f_i; } liga;"))
const formatted = formatFea(
	"feature liga{sub f i by f_i;}liga;",
	JSON.stringify({ lineWidth: 100 }),
)
```

The Node entry point initializes itself:

```ts
import { formatFea, parseFea } from "@create-font/fea-rs-wasm/node"
```

`parseFea` invokes `fea-rs` and returns JSON with `abiVersion`, `sourceLen`, a
recursive `root`, and recoverable `diagnostics`. Every node and token has a
half-open UTF-8 byte range. Tokens include their exact source text, including
whitespace and comments, so concatenating the token text reconstructs the input
byte for byte.

ABI version `1` uses owned JavaScript strings on both sides of each call. The
module owns its linear memory, and the Rust API keeps no document handles,
cached trees, or source text after a call returns. A breaking JSON shape,
diagnostic code, or ownership change requires an ABI version bump.

Includes are intentionally not loaded by the binding boundary. An
`include(path.fea)` statement remains in the concrete syntax tree; the host owns
filesystem or network resolution.

`formatFea` accepts JSON with these properties:

- `lineWidth` (default `80`);
- `indentWidth` (default `2`);
- `useTabs` (default `false`);
- `newLineKind`: `"auto"`, `"lineFeed"`, or `"carriageReturnLineFeed"`.

Formatting is fail-closed. If parsing reports an error, no rewritten text is
returned.

## Syntax coverage and deviations

Parsing is provided by `fea-rs` 0.22 and follows its Adobe Feature File grammar,
including GSUB and GPOS rules, named lookups, glyph classes, value records,
feature variations, and the supported Adobe table blocks. The repository
fixture exercises languagesystems, classes, includes, lookup blocks,
substitution, contextual rules, positioning, value records, and GDEF.

This binding intentionally exposes syntax parsing only. Project-aware include
loading, glyph inventory checks, lookup validation, and create-font semantic
lowering belong to the host analysis layer. Diagnostic codes and byte ranges
are normalized at the binding boundary; explanatory text and syntax-kind names
follow the pinned `fea-rs` release.

## Rebuilding

Install the versions pinned by the repository and build:

```sh
mise install
pnpm exec vp run @create-font/fea-rs-wasm#build
```

The build uses mise-managed Cargo, Rust, the `wasm32-unknown-unknown` target,
and `wasm-bindgen-cli`. Generated bindings and Wasm stay under the ignored
`dist/` directory and are included only in the published package.

Run the package checks with:

```sh
pnpm exec vp run @create-font/fea-rs-wasm#build
pnpm --filter @create-font/fea-rs-wasm test
pnpm --filter @create-font/fea-rs-wasm pack --dry-run
```

`dist/create-font-fea-rs-wasm.json` records the ABI version, byte size, and
SHA-256 of both runtime artifacts.

## Reference size and performance

A release runtime built with Rust 1.97.1 is approximately 278 kB. Regenerate
performance measurements after a build with:

```sh
pnpm --filter @create-font/fea-rs-wasm benchmark
```
