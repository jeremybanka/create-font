# create-font roadmap

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
- filesystem discovery for `fonts/*/create-font.json`, validated content-hash
  reads, and journaled conditional single- and multi-unit writes;
- a checked-in `fonts/workbench-sans` development source with two masters and
  the complete printable ASCII repertoire;
- a deterministic target-v1 SFNT serializer and `font build` path that writes
  atomic artifacts; and
- a browser editor prototype with text preview, outline editing, selection, and
  glyph-local history, now hydrated from and persisted to that source over RPC.

The `create-font` package provides a preliminary Bun/comline CLI and composes
`@create-font/server` with the editor's exported Preact application root through
Bun's full-stack development server. It opens and persists a real project
source and compiles `.ttf` artifacts, but does not yet publish live build status
through the workspace protocol.

## 1. Repository source workspace

- Add filesystem watching, event coalescing, and periodic reconciliation.
- Make remote invalidations refresh atom.io loadables without disturbing
  unrelated timelines.
- Preserve stable IDs and deterministic ordering across edit, save, external
  change, and migration.
- Add migrations, source-located diagnostics, and realistically large fixtures.
- Explicitly separate canonical source, generated intermediates, final outputs,
  caches, and per-user editor state.

## 2. Complete deterministic font builds

- Extend binary conformance checks and round-trip visual fixtures against more
  independent font tooling.
- Add build configuration and multi-output profiles without embedding
  environment-specific paths in canonical source.
- Publish build status and structured warnings through the workspace protocol.

## 3. Workspace server and browser persistence

- Add paged inventory, watching, reconciliation, diagnostics, and build status
  to the existing codec-neutral workspace contract.
- Bundle version-matched editor assets in the public package and serve them from
  the same origin as the workspace API.
- Replace eager whole-project hydration with lazy source loading suitable for
  large glyph sets.
- Add durable local drafts, external-change conflicts, reconnect behavior, and
  explicit saved/dirty/queued/conflicted UI states.
- Exercise the same server over loopback locally and through SSH port forwarding
  without adding SSH behavior to create-font.

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

- A font repository can install create-font as a dev dependency and build without a
  global create-font installation.
- A clean checkout plus its declared toolchain deterministically reproduces its
  font outputs.
- Visual edits produce understandable JSON diffs and do not rewrite unrelated
  source units.
- The browser has no direct filesystem authority and cannot silently overwrite
  external changes.
- The same `font dev` process works locally and in a remote checkout
  reached through standard port forwarding.
- Terminal builds, textual edits, visual edits, Git, and CI all operate on the
  same canonical repository source.
