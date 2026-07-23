# create-font architecture

## Product model

create-font is a repository-local font toolchain with a browser-based visual
editor. A font repository installs `create-font` as a development dependency and
commits its source and toolchain configuration. create-font is not a hosted source
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

The CLI is the automation boundary. `create-font` creates workspaces and adds font
projects. The repository-local `font build` validates and compiles a project into
font binaries. `font dev` watches the same project, serves
the web application, and exposes workspace operations to it. Checks, migrations,
and other noninteractive commands should use the same underlying services.

### Code editor

Textual source stays textual. Font information and other intentionally
hand-editable JSON can be edited directly. Programmable shaping and generation
logic can be written in an appropriate source language and compiled to a
portable, sandboxable module format such as WebAssembly.

create-font should provide schemas, stable diagnostics, formatting, and eventually
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
font dev
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

The canonical structured source is a versioned directory of JSON documents
with stable entity IDs and file boundaries aligned with useful editor
loadables:

```text
fonts/
  workbench-sans/
    create-font.json
    metadata.json
    names.json
    metrics.json
    style.json
    axes/
      index.json
      *.json
    masters/
      index.json
      *.json
    instances/
      index.json
      *.json
    glyphs/
      index.json
      *.json
    cmap/
      index.json
      *.json
```

Each index preserves author order and maps stable identities to explicit safe
paths. Axes, masters, instances, glyphs, and character mappings are individually
loadable; one glyph file contains all atoms owned by that glyph's undo timeline.
`@create-font/source` exports one Zod validator per file kind, JSON Schema
generation, and split/assemble operations for `EditorFontSource`.

The complete-document codec remains useful for interchange, migrations,
in-memory backends, and whole-snapshot validation. Programmable behavior such
as `features/layout.rs` remains a separate compiler input rather than an editor
state unit.

### Decision: master-local outlines

Editor source version 5 stores a complete ordered contour list inside every
glyph/master layer. Contours and nodes have layer-local stable IDs, topology,
mode, geometry, and handles. There is deliberately no glyph-level shared
topology.

Interpolation correspondence is an explicit ordinal contract: path _n_ maps to
path _n_, and node _m_ in that path maps to node _m_. Compatibility validation
compares path count, open/closed state, node count, and the projected
on/off-curve pattern. It returns typed diagnostics with both masters' stable IDs
and ordinal locations. Export stops on an incompatibility; it never repairs one
by unioning, sorting, reversing, or otherwise changing authored paths.

This representation permits masters to be authored independently while keeping
correspondence inspectable and deterministic. The editor visualizes the
contract with a comparison ghost, mapping lines, ordinal colors, and an
undoable path-order control. A v4 loader joins shared topology to each layer by
`pointId`; the default layer keeps its IDs and other layers receive deterministic
master-qualified IDs. Missing, duplicate, or unknown joins are migration errors.

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
because create-font builds it. It can remain a separate compiler input that joins
the pipeline before final lowering. The same separation can support generators
and other programmable transforms later.

## Persistence and external changes

Reads return canonical content plus an opaque revision or content hash. Writes
include the expected revision and an idempotency key, use a private temporary
sibling, and atomically replace the target. A changed revision produces a
conflict instead of overwriting work performed by another editor or Git.
Operations that create, delete, or reorder entities must eventually update an
index and one or more entity units through one atomic multi-unit transaction.

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
browser opens the loopback address printed by `font dev`. Remotely, the
user runs that command inside the checkout through an ordinary SSH session and
forwards the loopback port with OpenSSH, an IDE, or their existing development
environment.

create-font does not implement SSH, copy a second host into the remote machine, or
synchronize a shadow checkout. Node, the package manager, and the repository's
development dependencies are provisioned by the repository's normal toolchain,
which may use mise, Nix, a container, or another explicit environment manager.

The server binds to loopback by default. Non-loopback listening must be explicit
and introduce authentication, origin checks, request limits, and clear warnings.
Project paths are always relative to an opened root and must reject traversal,
NULs, symlink escapes, and other attempts to broaden authority.

## Package and process ownership

The intended public distribution is the `create-font` npm package:

- installed in the font repository as a dev dependency;
- exposes a package-manager-resolved `create-font` executable;
- contains or depends on the compiler, source codecs, and workspace server; and
- bundles the matching browser application as immutable assets.

Today, `@create-font/target` provides the logical-SFNT TypeScript library;
`@create-font/source` defines the JSON directory contract; `@create-font/server`
provides the Elysia/Eden workspace boundary; and the unscoped `create-font`
package owns the runtime-portable CLI and composes the server with the editor
application. The remaining build, test, and development dependencies are
inventoried in
[runtime portability](runtime-portability.md).
The private `@create-font/editor` package exports its Preact application root,
which the `create-font` browser entry serves through Elysia's Bun full-stack
development pattern. The application discovers `fonts/*/create-font.json`, serves
the selected project through a filesystem-backed source service, hydrates the
browser from individual source units, and persists coordinated edits through
conditional multi-unit writes. Watching and reconciliation, immutable release
assets, and binary serialization remain roadmap work.

## Architectural non-goals

- Replacing the user's terminal, text editor, SSH client, or Git workflow.
- Giving the browser unrestricted filesystem or process access.
- Requiring a globally installed create-font executable.
- Hiding canonical source in a database or browser-only storage.
- Treating generated font binaries as the editable source of truth.
- Making remote development depend on SSHFS or bidirectional repository sync.
