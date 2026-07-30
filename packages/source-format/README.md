# `@create-art/source-format`

The versioned formatting contract for application-owned create-font and
create-design source. Application writes use bundled, trusted Wasm formatters;
an opened project cannot replace their configuration or plugin code.

Contract version 1 pins:

- dprint `0.55.2`;
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

Install the contract and the exact host explicitly so incompatibility is
visible in the project lockfile:

```sh
pnpm add --save-dev @create-art/source-format dprint@0.55.2
```

Extend the published configuration without copying it:

```json
{
	"extends": ["./node_modules/@create-art/source-format/dprint.json"],
	"includes": ["fonts/**/*.{json,fea}", "designs/**/*.json"]
}
```

The package configuration resolves its pinned JSON and feature plugins from
its own dependencies. Do not add another JSON or FEA plugin or override their
settings. `SOURCE_FORMAT_*_VERSION` exports let integrations assert the
contract at runtime.

Use the ordinary dprint workflows:

```sh
pnpm exec dprint fmt
pnpm exec dprint check
pnpm exec dprint check fonts/my-font designs/my-design
```

Run `pnpm exec dprint check` in CI and from a pre-commit hook. VS Code's dprint
extension automatically consumes the project `dprint.json`; other editors can
run `pnpm exec dprint lsp`. A version mismatch should be corrected in the
package manifest and lockfile instead of accepted as a formatting change.

Node adapters may call `formatSourceJson()` and `formatSourceFea()` directly.
Browser and worker consumers import `@create-art/source-format/browser` for
the portable JSON policy and serialization seed; formatter plugin loading
remains at the trusted application adapter boundary.
