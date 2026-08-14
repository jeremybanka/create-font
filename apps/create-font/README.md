# create-font

`create-font` is the application package for the create-font font toolchain. It
ships three Node-compatible executables with separate roles. Create a new
workspace with the initializer:

```sh
npx create-font my-font
cd my-font
npm exec -- font dev
```

The generated workspace lists only `create-font` as a development dependency.
Installing that package links both `create-font` and `font` locally. Inside an
existing workspace, the initializer adds another font project without replacing
the workspace or reinstalling its dependencies:

Run `npx create-font display-font` to add another font.

The repository development workflow, browser builds, and test suite use the
Node and pnpm versions pinned by `mise.toml`. The installed runtime source uses
Node-compatible APIs that Bun also implements. The interactive Elysia server
selects its native Bun adapter under Bun and its official Node adapter
otherwise. A smaller Bun CI job exercises the native adapter and built CLI. The
command-line interface is defined with `comline`; its interactive server is an
Elysia application; and
`create-font/rpc-client` exposes the corresponding Eden Treaty client factory.
The reusable workspace routes and client typing live in `@create-font/server`;
this package composes them with the editor application and CLI build handler.
The composed application discovers projects below `fonts/`, attaches the
filesystem source service, and hydrates the editor through the same Elysia/Eden
contract used for persistence. This keeps the server independent from the
atom.io implementation in `@create-font/states`.

## Executables

`create-font [name]` creates a workspace when the current directory is not one,
or creates `fonts/<name>` when run inside an existing create-font workspace. A
new workspace contains a private `package.json`, the local `create-font`
development dependency, and a minimal validated Regular font source with one
default master. New workspaces use `npm install` by default. Pass
`--package-manager=pnpm`, `--package-manager=yarn`, or `--package-manager=bun`
to choose another installer, or `--no-install` to defer installation.

Import a Glyphs 2 or 3 text source directly into the same native directory
format with `--from`:

```sh
npx create-font --from ./MyFamily.glyphs --no-install
# or choose the project directory name explicitly
npx create-font my-family --from ./MyFamily.glyphs
```

Without an explicit name, a filesystem-safe form of the `.glyphs` filename
becomes the workspace and font directory name. Import finishes parsing,
lowering, and native source validation before it creates the font directory,
writes all font JSON units in a private sibling directory, then publishes that
complete font project with one rename. A newly named workspace is staged as a
whole when its destination does not exist. When the destination is an existing
user-owned empty directory, that directory is preserved and workspace metadata
can precede the atomic font-directory publication. Syntax and lowering failures
include a source path (and line/column for plist syntax); lossy but usable
conversions are printed as warnings. Binary plists and `.glyphspackage`
directories are not accepted—save an editable text `.glyphs` file first.
Components are expanded to contours; anchors, guides, background/special
layers, variable kerning beyond the default master, and other unsupported
authoring metadata are diagnosed rather than silently represented. See the
`@create-font/source` support table for the complete conversion contract,
expansion limits, and the current build scalability caveat for very large
component-heavy, multi-master sources.

`font build [name]` validates the selected directory source, projects it through
the editor compiler, and emits a deterministic variable TrueType font. Outputs
stay outside canonical source below
`artifacts/<project>/<PostScriptName>.ttf`; the command prints the absolute
artifact path on success. The file is replaced atomically only after source
validation, target ingestion, and serialization complete.

Run `npm exec -- font build workbench-sans` to build with Node, or invoke the
same local executable with Bun.

The target-v1 profile supports simple unhinted quadratic glyphs, complete
`gvar` point deltas, a Windows Unicode `cmap`, named instances, the required
13-table variable TrueType set, and optional `avar`. Composite glyphs,
OpenType Layout, color, vertical metrics, and instructions remain later
profiles.

`font dev [name]` starts the Elysia workspace process on loopback by default. It
discovers `fonts/*/create-font.json`, selects the sole project automatically, and
serves its validated source units through the workspace RPC. With multiple font
projects, select one by directory name:

Run `npm exec -- font dev workbench-sans` with Node, or invoke the same local
executable with Bun. The server uses the Create Art application group's
distinctive `http://127.0.0.1:16384/` default; pass `--port` to override it.
One Ctrl-C gracefully closes the workspace server.

`font serve` remains an alias for `font dev`.

## LAN multiplayer

Add `--share` to host the selected font on the local network:

```sh
npm exec -- font dev workbench-sans --share
```

The command starts the ordinary workspace server on loopback, wraps it in a
short-lived HTTPS LAN endpoint, prints an invitation and terminal QR code, and
opens the host through a loopback gateway. HTTPS is zero-configuration: each
host process creates an ephemeral certificate and its fingerprint is pinned in
the signed invitation flow rather than delegated to the ambient network.

A collaborator copies the printed command or scans/copies its token:

```sh
npm exec -- font join '<invitation>'
```

`font join` reads the effective Git `user.name` and `user.email`, signs that
friendly identity with a persistent local device key, requests admission, and
opens a loopback gateway. The host must approve the device as an editor or a
viewer for every host process. The browser remains connected directly to the
host machine through the local gateway; no relay, hosted account, or cloud
source of truth is involved. The host can revoke a guest at any time, which
invalidates the session and disconnects all of that device's open tabs.
If the effective Git name or email is missing, an interactive terminal prompts
for it before sending an admission request; a non-interactive join exits with
an actionable error instead of inventing an identity.

Invitations and admitted guest credentials expire after 12 hours at the
latest, and stopping the host invalidates them immediately. Restarting
`font dev --share` always creates a new certificate, invitation, admission
queue, and shared in-memory history. Rejoining therefore requires the new
invitation and a new host decision.

Only the host can invoke raw workspace writes, builds, comparisons, commits,
and other source APIs. Editors submit a closed set of validated font commands
over the collaboration socket; viewers cannot mutate the document. The host
persists each accepted command with source revision checks before broadcasting
confirmation. External filesystem or Git changes advance the session epoch and
cause connected clients to recover from an authoritative snapshot. A change
isolated to one glyph clears only that glyph's shared history; kerning changes
clear the kerning history; structural changes conservatively reset every
affected timeline. Invalid external source remains diagnostic data and does not
replace the last valid shared document.

Glyph and kerning edits retain the editor's existing atom.io timeline families.
All editors participate in that shared global history: undo and redo operate on
the currently active glyph or kerning scope. History remains process-memory
state and is intentionally not written into canonical font source.

The invitation is a bearer capability for requesting admission, so share it
only with intended LAN peers. Device name and email are visible to participants
by default, matching Git's authorship convention. Browser-only direct guest
connections, internet relays, resumable offline editing, durable history, and
user-centric selective undo are outside this first multiplayer release.

The collaboration transport is covered under both supported runtimes. Node
uses Socket.IO's WebSocket transport; Bun uses Socket.IO's HTTP long-polling
transport because its Node-compatible HTTPS upgrade socket cannot currently
carry the gateway's raw upgraded byte stream. Both paths retain the same
pinned-HTTPS, authorization, ordering, persistence, and presence contracts.

## Adobe feature tooling

`font check [name]` validates every indexed `.fea` source and its transitive
includes without compiling a font or writing any files. The default `stylish`
format prints source frames to stderr. `--format=json` writes the complete,
deterministically ordered diagnostic array to stdout for CI. Errors, file
failures, and Wasm initialization failures exit nonzero; warnings are reported
but do not affect the exit code. `NO_COLOR` disables terminal color and
`FORCE_COLOR=1` enables it.

All feature consumers use the same project-aware operation from
`@create-font/source`. The operation calls the Rust/`fea-rs` parser through its
versioned Wasm ABI, resolves includes in the project host, converts UTF-8 parser
ranges to UTF-16, checks exported glyph names, and lowers only the semantic
subset the target supports. Adobe syntax accepted by `fea-rs` is not
necessarily compilable by create-font: unsupported positioning, lookup, class,
table, and other constructs produce `fea.unsupported` diagnostics rather than
being ignored. dprint formatting likewise establishes syntactic validity, not
create-font semantic support.

`create-font-fea-lsp --stdio` starts the standalone language server. It supports
incremental document synchronization, multiple workspace folders, open-buffer
overrides, watched feature/index/glyph inputs, stale-result suppression,
project glyph and keyword completion, document symbols, and glyph hover.
Operational JSON logs go only to stderr and are controlled by
`CREATE_FONT_FEA_LOG_LEVEL=off|error|info|debug`; stdout remains LSP protocol
traffic.

Build the platform-independent VS Code extension with:

```sh
font vsix --build-only
```

The resulting `artifacts/CreateFontFeatures.vsix` bundles the language client,
server, parser JavaScript, and parser Wasm. Omit `--build-only` to install it
with `code`, or select a compatible editor with
`font vsix --target=code-insiders`. The extension recognizes `.fea`, includes
basic highlighting, and provides **Create Font: Restart Feature Language
Server**. Settings:

- `createFont.features.executablePath`: alternate LSP executable;
- `createFont.features.modulePath`: alternate server module;
- `createFont.features.logLevel`: operational logging;
- `createFont.features.trace.server`: protocol tracing, independently.

If the server reports a Wasm ABI or initialization failure, rebuild/reinstall
the VSIX and ensure an alternate server path is not mixing create-font
versions. No Rust toolchain or native parser executable is used at runtime.

Reads carry content-hash revisions. Single- and multi-unit writes use
optimistic concurrency, idempotency keys, whole-project validation, and a
transaction journal so coordinated entity/index edits either commit together
or roll back.

## Editor application boundary

The consumer package owns `public/index.html` and `public/index.tsx`. Its small
browser bootstrap opens the server event stream before loading one coherent
source snapshot, assembles that snapshot into local editor state, and persists
changed units directly through the multi-write route. Ordered events carry only
changed and removed units. A revision gap or reconnected stream recovers through
one fresh snapshot. Dirty tabs buffer remote events until their local
revision-guarded write completes, so another window cannot silently replace an
edit that is waiting to save.

The server is the sole source revision sequencer and durable authority. The
browser uses the browser-only `@create-font/source/browser` entrypoint to split
editor state into unit writes; Zod schemas, whole-project validation, and the
transaction journal stay in the server process.

`@create-font/editor` publishes its own browser-ready `editor.js` and
`editor.css`. The Elysia server resolves those files from the installed
production dependency and serves them under `/editor/`. Once a source is ready,
the bootstrap dynamically imports the editor and calls its `mountEditor`
boundary. The editor artifact owns its Preact renderer and hooks; it never
shares component state with the bootstrap bundle.

The repository's `pnpm dev` command splits the development serving path at a
deliberate boundary. Node runs the Elysia HTTP and WebSocket API in watch mode
on port 3001. Vite serves `public/index.tsx` on port 3000 with Preact and CSS
HMR. Vite aliases the editor browser entry to its workspace source and proxies
`/api`, including WebSocket upgrades, to Node, so editor changes retain HMR
without requiring a package build. Production emits only the bootstrap under
`dist/public`; the editor implementation remains in the dependency package
instead of being duplicated there.
