# `@create-art/source-format`

The versioned formatting contract for application-owned create-font and
create-design source. Application writes use bundled, trusted Wasm formatters;
an opened project cannot replace their configuration or plugin code.

Contract version 2 pins:

- dprint `0.56.0`;
- `@dprint/json` `0.23.0`; and
- `dprint-plugin-fea` `0.1.1`.

JSON uses an 80-column width, tabs with width 2, recursively sorted object
names, LF line endings, and exactly one final newline. Arrays retain semantic
author order. JavaScript's JSON number spelling is retained, including an
explicit `-0`. Adobe feature source uses an 80-column width, two spaces, LF
line endings, and the same final-newline rule. Placed SVG, images, fonts, and
other byte-preserved assets are not formatted.

Parsing accepts valid noncanonical whitespace. A write validates and
semantically normalizes its affected unit, formats it, then hashes and persists
those final bytes. Opening a workspace never reformats it, and a transaction
does not rewrite unaffected units.

## Project tooling

Install the contract:

```sh
pnpm add --save-dev @create-art/source-format
```

Use its canonical source command for manual formatting, pre-commit hooks, and
CI:

```sh
pnpm exec create-source-format fmt fonts designs
pnpm exec create-source-format check fonts designs
```

The command recursively finds application-owned `.json` and `.fea` files,
ignoring application control directories, Git metadata, and `node_modules`.
For JSON it parses the semantic value, recursively sorts object names through
the same serialization seed used by application writes, and then invokes the
pinned Wasm formatter. Consequently compact, hand-multiline, and CRLF input
with the same value converge on the exact bytes written by the application.
`check` reports noncanonical paths without modifying them.

Configure an editor's external format-on-save command to run
`pnpm exec create-source-format fmt` with the current file path. A generic
editor task can use:

```sh
pnpm exec create-source-format fmt "${file}"
```

Projects that also install `dprint@0.56.0` may extend the published lexical
configuration without copying it:

```json
{
	"extends": ["./node_modules/@create-art/source-format/dprint.json"],
	"includes": ["fonts/**/*.{json,fea}", "designs/**/*.json"]
}
```

The configuration pins indentation, line width, line endings, and
input-layout-independent single-line preferences. The dprint JSON plugin
cannot recursively sort object names, so bare `dprint fmt`, editor extensions
that invoke only dprint, and `dprint lsp` are not canonical source workflows.
They are safe as supplementary syntax formatters after the canonical command.
Do not add another JSON or FEA plugin or override the published settings.
`SOURCE_FORMAT_*_VERSION` exports let integrations assert the contract at
runtime. A version mismatch should be corrected in the package manifest and
lockfile instead of accepted as a formatting change.

Node adapters call `formatSourceJson()` and `formatSourceFea()` directly.
Formatting is deliberately unsupported in browsers and workers: synchronous
browser formatting cannot load the pinned Wasm plugin without either an
untrusted runtime fetch or a second formatter implementation. Those consumers
may import `@create-art/source-format/browser` for contract metadata and the
semantic serialization seed, but formatting calls fail closed. Source
validation and parsing remain portable; the trusted application adapter owns
the only canonical formatting path.
