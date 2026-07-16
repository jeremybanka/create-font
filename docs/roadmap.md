# Trigraph roadmap

This roadmap connects the existing font model, editor state graph, JSON codec,
and browser prototype to the repository-local toolchain described in the
[architecture](architecture.md). Ordering is architectural; individual slices
should remain small enough to ship and verify independently.

## Current foundation

The repository already contains:

- a validated logical-SFNT model and detailed lowering plan for a narrow
  TrueType variable-font profile;
- a high-level editor state graph that projects design-space sources into that
  model;
- a deterministic, lossless codec for complete editor-state JSON documents;
- a versioned, multi-file JSON directory contract with Zod validators and JSON
  Schema generation;
- a reusable Elysia/Eden workspace RPC package and atom.io Loadable cache keyed
  by individual source-unit paths;
- a browser editor prototype with text preview, outline editing, selection, and
  glyph-local history.

The current editor demo is in-memory. The `trigraph` package now provides a
preliminary Bun/comline CLI and composes `@trigraph/server` with the editor's
exported Preact application root through Bun's full-stack development server.
It does not yet serialize `.ttf` files, open a source directory, or persist
project edits.

## 1. Repository source workspace

- Implement filesystem discovery and canonical reads for the established
  `trigraph.source` v1 directory.
- Implement conditional atomic writes for individual units and atomic
  multi-unit writes for entity/index changes.
- Connect source-unit validators to the server and concrete atom.io hydration
  transactions.
- Preserve stable IDs and deterministic ordering across edit, save, external
  change, and migration.
- Add migrations, source-located diagnostics, and realistically large fixtures.
- Explicitly separate canonical source, generated intermediates, final outputs,
  caches, and per-user editor state.

## 2. Complete deterministic font builds

- Finish binary serialization for the current 13-table TrueType variable-font
  profile.
- Make projection, ingestion, lowering, and serialization one diagnostic-rich
  compiler pipeline.
- Add reproducibility tests, binary conformance checks, and round-trip visual
  fixtures against independent font tooling.
- Introduce the package-resolved `trigraph build` command.
- Define configuration and output naming without embedding environment-specific
  paths in canonical source.

## 3. Workspace server and browser persistence

- Introduce a codec-neutral workspace contract and run the demo through an
  in-memory implementation first.
- Implement `trigraph serve` with project discovery, paged inventory, versioned
  reads, conditional atomic writes, watching, reconciliation, diagnostics, and
  build status.
- Bundle version-matched editor assets in the public package and serve them from
  the same origin as the workspace API.
- Replace the editor's static fixture with reactive project state and lazy source
  loading suitable for large glyph sets.
- Add durable local drafts, external-change conflicts, reconnect behavior, and
  explicit saved/dirty/queued/conflicted UI states.
- Exercise the same server over loopback locally and through SSH port forwarding
  without adding SSH behavior to Trigraph.

## 4. Review and diagnostics workflow

- Present projection, validation, compilation, and serialization diagnostics in
  the browser with stable entity and source locations.
- Add proof views and representative text/sample management.
- Render semantic visual diffs between worktree, index, commit, and build
  artifacts while leaving Git operations usable from existing tools.
- Make external builds and source edits converge through the watcher and
  reconciliation model.
- Produce CI-friendly diagnostics and review artifacts from noninteractive CLI
  commands.

## 5. Programmable font behavior

- Specify a versioned, deterministic module interface for font-domain code.
- Prototype Rust-to-WebAssembly authoring for OpenType Layout rules, beginning
  with `liga` and `calt`.
- Define capability limits, resource limits, caching, diagnostics, and source
  maps before executing project modules.
- Compose compiled layout data into the build pipeline without forcing textual
  rules into the interactive state graph.
- Extend the interface to generators or other transforms only when they can
  preserve deterministic builds and clear source ownership.

## Later profiles

Composite glyphs, hinting, sparse/IUP variation data, vertical metrics,
CFF/CFF2, color and bitmap fonts, and broader OpenType Layout coverage remain
future profiles. They should extend the same source/build/server boundaries
rather than bypass them.

## Product-level acceptance criteria

- A font repository can install Trigraph as a dev dependency and build without a
  global Trigraph installation.
- A clean checkout plus its declared toolchain deterministically reproduces its
  font outputs.
- Visual edits produce understandable JSON diffs and do not rewrite unrelated
  source units.
- The browser has no direct filesystem authority and cannot silently overwrite
  external changes.
- The same `trigraph serve` process works locally and in a remote checkout
  reached through standard port forwarding.
- Terminal builds, textual edits, visual edits, Git, and CI all operate on the
  same canonical repository source.
