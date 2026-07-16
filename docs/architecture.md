# Trigraph architecture

## Product model

Trigraph is a repository-local font toolchain with a browser-based visual
editor. A font repository installs `trigraph` as a development dependency and
commits its source and toolchain configuration. Trigraph is not a hosted source
of truth and does not require a globally installed desktop application.

The experience deliberately resembles a code editor:

- source is explicit, reviewable, and friendly to Git;
- builds are deterministic and scriptable;
- diagnostics identify source locations and stable entities;
- visual edits are structured file edits, not mutations of an opaque document;
- generated artifacts and local UI state are never confused with source; and
- external editors, Git operations, and CI are first-class participants.

## Three surfaces

### Terminal

The CLI is the automation boundary. `trigraph build` validates and compiles the
project into font binaries. `trigraph serve` watches the same project, serves
the web application, and exposes workspace operations to it. Checks, migrations,
and other noninteractive commands should use the same underlying services.

### Code editor

Textual source stays textual. Font information and other intentionally
hand-editable JSON can be edited directly. Programmable shaping and generation
logic can be written in an appropriate source language and compiled to a
portable, sandboxable module format such as WebAssembly.

Trigraph should provide schemas, stable diagnostics, formatting, and eventually
language-tooling integration without attempting to replace the programmer's
editor.

### Browser

The browser owns interactive and spatial concerns: outline editing, selection,
preview text, proofs, samples, visual diffs, diagnostic presentation, and local
undo history. It does not receive arbitrary filesystem authority. It reads and
writes project source through the workspace protocol served by the CLI.

## Runtime boundary

```text
browser editor
  - canvas and UI state
  - loaded editor state
  - dirty buffers and undo history
          |
          | versioned HTTP/WebSocket protocol
          v
trigraph serve
  - serves version-matched editor assets
  - discovers and validates the project
  - reads, watches, and atomically writes source
  - compiles and publishes diagnostics
  - exposes build products and source/Git facts for review
          |
          v
font repository
  - canonical JSON and code sources
  - project configuration
  - generated intermediates and font outputs
```

The server and browser assets come from the same installed package, so their
protocol versions match by construction. A handshake still reports protocol,
project-schema, codec, compiler, and optional capability versions so stale tabs
and incompatible projects fail clearly.

The protocol should describe font-workspace operations rather than expose a
generic remote filesystem or shell. Initial operations include project
discovery, a paged source inventory, versioned reads, conditional writes,
watcher invalidations, diagnostics, and build status.

## Project source

The canonical project source is expected to be a directory of JSON documents,
with stable entity IDs and deliberately chosen file boundaries. Exact names and
granularity remain a format-design decision, but the direction is:

```text
font-family/
  package.json
  trigraph.json
  src/
    font.json
    axes.json
    glyphs/
      A.json
      B.json
    features/
      layout.rs
  build/
    Family[wdth,wght].ttf
```

`font.json`, `axes.json`, and glyph files illustrate canonical structured font
data; they are not a committed schema. `layout.rs` illustrates separately
compiled behavior referenced by project configuration. Build output paths are
also configurable.

The current `@trigraph/source` codec serializes one complete
`EditorFontSource` document. That remains a useful validation and canonical
encoding boundary, but it is not the eventual project-storage contract. A
workspace source layer will compose multiple versioned JSON units into editor
state and write changed units back without rewriting unrelated files.

Source formats must distinguish:

- canonical source committed to the repository;
- derived intermediates that can be reproduced;
- final font binaries and proof artifacts; and
- per-user editor state, caches, drafts, and connection data.

## Builds and programmable behavior

All entry points share one deterministic compilation pipeline:

```text
project JSON + compiled behavior
              -> editor/design-space projection
              -> validated logical SFNT
              -> binary serialization
              -> fonts, diagnostics, and review artifacts
```

The code interface must be narrower than arbitrary process execution. Compiled
modules receive versioned font-domain inputs and return versioned data plus
diagnostics. Capability, determinism, resource-limit, and caching rules must be
part of that interface before untrusted modules are enabled in the browser or
server.

OpenType Layout does not need to become mutable atom-by-atom editor state merely
because Trigraph builds it. It can remain a separate compiler input that joins
the pipeline before final lowering. The same separation can support generators
and other programmable transforms later.

## Persistence and external changes

Reads return canonical content plus an opaque revision or content hash. Writes
include the expected revision and an idempotency key, use a private temporary
sibling, and atomically replace the target. A changed revision produces a
conflict instead of overwriting work performed by another editor or Git.

Watcher events are hints. The server coalesces them, rescans affected source
units, and periodically reconciles the project. Bulk operations such as branch
checkout may produce one project invalidation rather than thousands of file
events.

The browser keeps dirty buffers and undo history locally. A disconnected tab may
continue editing already loaded glyphs, but must describe changes as queued or
unsaved rather than remotely persisted. Reconnection refreshes revisions before
replaying changes; divergence requires an explicit conflict workflow.

## Local and remote development

Local and remote workspaces use the same process and protocol. Locally, the
browser opens the loopback address printed by `trigraph serve`. Remotely, the
user runs that command inside the checkout through an ordinary SSH session and
forwards the loopback port with OpenSSH, an IDE, or their existing development
environment.

Trigraph does not implement SSH, copy a second host into the remote machine, or
synchronize a shadow checkout. Node, the package manager, and the repository's
development dependencies are provisioned by the repository's normal toolchain,
which may use mise, Nix, a container, or another explicit environment manager.

The server binds to loopback by default. Non-loopback listening must be explicit
and introduce authentication, origin checks, request limits, and clear warnings.
Project paths are always relative to an opened root and must reject traversal,
NULs, symlink escapes, and other attempts to broaden authority.

## Package and process ownership

The intended public distribution is the `trigraph` npm package:

- installed in the font repository as a dev dependency;
- exposes a package-manager-resolved `trigraph` executable;
- contains or depends on the compiler, source codecs, and workspace server; and
- bundles the matching browser application as immutable assets.

Today, `@trigraph/target` provides the logical-SFNT TypeScript library and the
unscoped `trigraph` package provides a preliminary Bun CLI, Elysia server, and
Eden client boundary. The private `@trigraph/editor` package exports its Preact
application root, which the `trigraph` browser entry imports and serves through
Elysia's Bun full-stack development pattern. Packaging the editor as immutable
release assets, the project/workspace source layer, and binary serialization
remain roadmap work.

## Architectural non-goals

- Replacing the user's terminal, text editor, SSH client, or Git workflow.
- Giving the browser unrestricted filesystem or process access.
- Requiring a globally installed Trigraph executable.
- Hiding canonical source in a database or browser-only storage.
- Treating generated font binaries as the editable source of truth.
- Making remote development depend on SSHFS or bidirectional repository sync.
