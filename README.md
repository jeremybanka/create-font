# Trigraph

Trigraph is a source-oriented font toolchain with a browser-based visual editor.
It is intended to be installed in a font repository as an npm dev dependency,
so the repository remains the source of truth and the complete toolchain travels
with the project.

During development, Trigraph has three cooperating surfaces:

- the terminal, where `trigraph build` produces fonts and `trigraph serve`
  starts the workspace server;
- the programmer's ordinary editor, where programmable font behavior can be
  written as code; and
- the browser, where Trigraph provides spatial editing, proofs, samples, visual
  diffs, and diagnostics.

The CLI runs beside the source tree. It owns filesystem access, watching,
validation, compilation, and persistence, and it serves the web application and
its workspace protocol. The browser edits structured source through that
protocol rather than owning files directly. This also makes remote development
ordinary: run Trigraph in the remote checkout, forward its loopback port over
SSH, and use a local browser.

Canonical structured font data lives below `fonts/<project>/` in reviewable
JSON files. The checked-in `fonts/trigraph-sans` project is the development
font served by `pnpm dev`. Generated intermediates, binary outputs, and local
editor state remain separate. Programmable behavior such as OpenType Layout
rules may live in ordinary code files referenced by the project and compile to
a sandboxed module format such as WebAssembly.

See [the architecture](docs/architecture.md) for the durable system boundaries
and [the roadmap](docs/roadmap.md) for the path from the current libraries to
the complete toolchain.

## Packages

- [`trigraph`](packages/trigraph/README.md) is the Bun CLI and Elysia workspace
  application.
- [`@trigraph/server`](packages/server/README.md) owns the reusable workspace
  RPC contract, Elysia routes, and Eden client typing.
- [`@trigraph/target`](packages/target/README.md) is the validated, logical-SFNT
  compilation target.
- [`@trigraph/states`](packages/states/README.md) is the atom.io editor model
  that incrementally projects into that IR and hydrates remote source units.
- [`@trigraph/source`](packages/source/README.md) defines the versioned JSON
  directory contract, per-file Zod schemas, and deterministic codecs.
- [`@trigraph/editor`](packages/editor/README.md) is the Preact and Konva font
  editor built directly on that state graph.

These packages are the current implementation layers. The `trigraph`
application composes the reusable server boundary with the Bun full-stack
browser entry that imports `EditorApplicationRoot` from `@trigraph/editor`.

The workspace toolchain pins Bun through `mise.toml`; Bun is a repository
runtime, not an npm dependency. Run the complete development stack from the
workspace root:

```sh
mise install
pnpm install
pnpm dev
```
