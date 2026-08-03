# create-font workspace

This repository contains the sibling create-font and create-design products,
along with the create-art libraries they share. The repository name predates
create-design and still reflects its create-font origin.

create-font is a source-oriented font toolchain with a browser-based visual editor.
It is intended to be installed in a font repository as an npm dev dependency,
so the repository remains the source of truth and the complete toolchain travels
with the project.

During development, create-font has three cooperating surfaces:

- the terminal, where `create-font` creates workspaces and font projects while
  `font build` produces fonts, `font check` validates Adobe feature sources,
  and `font dev` starts the workspace server;
- the programmer's ordinary editor, where programmable font behavior can be
  written as code; and
- the browser, where create-font provides spatial editing, proofs, samples, visual
  diffs, and diagnostics.

The CLI runs beside the source tree. It owns filesystem access, watching,
validation, compilation, and persistence, and it serves the web application and
its workspace protocol. The browser edits structured source through that
protocol rather than owning files directly. This also makes remote development
ordinary: run `font dev` in the remote checkout, forward its loopback port over
SSH, and use a local browser.

Canonical structured font data lives below `fonts/<project>/` in reviewable
JSON files. The checked-in `fonts/workbench-sans` project is the development
font served by `pnpm dev`. Generated intermediates, binary outputs, and local
editor state remain separate. Programmable behavior such as OpenType Layout
rules may live in ordinary code files referenced by the project and compile to
a sandboxed module format such as WebAssembly.

Canonical design data follows the same source-oriented model below
`designs/<project>/`. The checked-in `designs/workbench-poster` project is the
geometric poster served by create-design during development.

See [the architecture](docs/architecture.md) for the durable system boundaries
and [the roadmap](docs/roadmap.md) for the path from the current libraries to
the complete toolchain.

## Packages

Applications live under `apps/`. Namespaced libraries use
`packages/<npm-scope>/<package-name>`, so filesystem and npm ownership match
directly. Unscoped tooling and framework-integration packages remain directly
under `packages/`.

- [`create-design`](apps/create-design/README.md) provides the design CLI,
  source workspace server, and application composition.
- [`@create-design/editor`](packages/create-design/editor/README.md) owns the
  create-design browser editor and document interaction model.
- [`@create-design/model`](packages/create-design/model/README.md) owns headless
  design geometry, color, artboard, and coordinate operations.
- [`@create-design/pdf`](packages/create-design/pdf/README.md) owns PDF
  projection, preflight, incremental compilation, and serialization.
- [`create-font`](apps/create-font/README.md) provides the `create-font`
  initializer, the repository-local `font` CLI, and the Elysia workspace
  application.
- [`@create-font/server`](packages/create-font/server/README.md) owns the reusable workspace
  RPC contract, Elysia routes, and Eden client typing.
- [`@create-font/target`](packages/create-font/target/README.md) is the validated, logical-SFNT
  compilation target.
- [`@create-font/states`](packages/create-font/states/README.md) is the atom.io editor model
  that incrementally projects into that IR and hydrates remote source units.
- [`@create-font/source`](packages/create-font/source/README.md) defines the versioned JSON
  directory contract, per-file Zod schemas, and deterministic codecs.
- [`@create-art/source-format`](packages/create-art/source-format/README.md) publishes the
  pinned canonical formatter and dprint policy shared by generators,
  application writes, editor commands, and CI.
- [`@create-font/editor`](packages/create-font/editor/README.md) is the Preact and Konva font
  editor built directly on that state graph.
- [`@create-art/editor`](packages/create-art/editor/README.md) owns product-neutral editor
  controls, tiling, canvas, vector interaction, and source review foundations.
- [`@create-art/preact-konva`](packages/create-art/preact-konva) provides the shared Preact
  bindings used by both product editors' Konva scenes.

These packages are the current implementation layers. Each application
composes its source workspace server with the browser entry supplied by its
product editor. Headless libraries never import an editor package.

## License policy

The project draws a deliberate line between **using our public building blocks**
and **shipping a modified version of our applications**. The exact file-level
terms are in [`LICENSE`](LICENSE); this section is their plain-English summary.

### Your work remains yours

Fonts, artwork, PDFs, project data, and other assets you create with create-font
or create-design are yours. You may use and license them for open or proprietary
projects, including commercial projects. The same permission covers ordinary
project files emitted by the initializers and scaffolders.

That permission does not relicense third-party inputs, the checked-in example
projects, or software copied into a plugin or extension. It also does not turn an
independent software extension into an “output”; the library and application
boundaries below still apply.

### Proprietary consumers are welcome at the library boundary

The reusable npm packages and Rust crates are licensed under
[MPL-2.0](LICENSES/MPL-2.0.txt). This is file-level copyleft: proprietary code
may import, link, compile, or bundle these libraries without becoming open
source. If you distribute changes to files from one of these libraries, those
changed files remain available under MPL, but your new and independent files may
use any license.

For example, a proprietary palette-generation library may target the
create-design palette format and may import `@create-design/source` for its
schemas and codecs. Its novel palette code does not become MPL-covered merely
because it consumes that package. Independently implementing one of the
documented source formats does not require using any repository code at all.

All currently published packages use MPL-2.0 except the application and editor
packages named below. Package manifests and package-local `LICENSE` files state
the boundary explicitly, including for transitive workspace dependencies.

### Application forks stay public

`create-font`, `create-design`, `@create-art/editor`, `@create-design/editor`,
and `@create-font/editor` are licensed under
[AGPL-3.0-or-later](LICENSES/AGPL-3.0-or-later.txt), with an
[additional output permission](LICENSES/OUTPUT-EXCEPTION.txt). You may use,
study, modify, redistribute, and sell them. If you distribute a modified
application, its corresponding source stays available under the AGPL. If you
operate a modified application for users over a network, those users must be
offered its corresponding source as well.

Private changes used only within one person or organization do not have to be
published. A genuinely independent application built against the MPL libraries
may also remain proprietary; copying or modifying the AGPL application code is
the boundary that makes a work an application fork.

### Documentation and checked-in examples

The root README, `docs/`, and `designs/workbench-poster/` use
[CC-BY-4.0](LICENSES/CC-BY-4.0.txt). The Workbench Sans example source under
`fonts/workbench-sans/` uses [OFL-1.1](fonts/workbench-sans.OFL.txt), without a
Reserved Font Name. These licenses apply only to the repository's checked-in
material, not to work created by users.

The workspace toolchain pins Node and pnpm through `mise.toml`. Bun is optional
and is exercised only by its compatibility CI job. Run the complete development
stack from the workspace root:

```sh
mise install
pnpm install
pnpm dev
```

The development command enables the packages' `development` export condition
and starts four consecutive servers. The default base port is 16384—the maximum
OpenType `unitsPerEm`—with create-font on 16384–16385 and create-design on
16386–16387:

|  Port | Server                |
| ----: | --------------------- |
| 16384 | create-font browser   |
| 16385 | create-font API       |
| 16386 | create-design browser |
| 16387 | create-design API     |

Shift the entire block for a parallel checkout with either form:

```sh
pnpm dev -- --port=20000
CREATE_ART_DEV_PORT=20000 pnpm dev
```

`pnpm dev:font` and `pnpm dev:design` run one application's two-server pair;
they accept the same `--port` option and the `CREATE_FONT_DEV_PORT` or
`CREATE_DESIGN_DEV_PORT` environment variable.

Node runs each workspace API in watch mode while Vite provides Preact and CSS
HMR and proxies HTTP and WebSocket API traffic to its paired backend. Each tab
keeps local editor state, persists changed source units directly to the server,
and consumes ordered unit deltas from the server's source event stream.
Development does not build or watch workspace package outputs. Production and
published consumers continue to resolve the compiled `dist` entrypoints.
