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

Canonical structured font data will live in a reviewable directory of JSON
files. Generated intermediates, binary outputs, and local editor state remain
separate. Programmable behavior such as OpenType Layout rules may live in
ordinary code files referenced by the project and compile to a sandboxed module
format such as WebAssembly.

See [the architecture](docs/architecture.md) for the durable system boundaries
and [the roadmap](docs/roadmap.md) for the path from the current libraries to
the complete toolchain.

## Packages

- [`trigraph`](packages/trigraph/README.md) is the validated, logical-SFNT IR.
- [`@trigraph/states`](packages/states/README.md) is the atom.io editor model
  that incrementally projects into that IR.
- [`@trigraph/source`](packages/source/README.md) is its deterministic,
  lossless JSON source-file codec.
- [`@trigraph/editor`](packages/editor/README.md) is the Preact and Konva font
  editor built directly on that state graph.

These packages are the current implementation layers. The public `trigraph`
package will grow a CLI entry point around them and bundle the editor assets;
it does not expose that executable yet.
