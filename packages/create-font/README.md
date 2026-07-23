# create-font

`create-font` is the application package for the create-font font toolchain. It
ships two Bun executables with separate roles. Create a new workspace with the
initializer:

```sh
bun create font my-font
cd my-font
bun font dev
```

The generated workspace lists only `create-font` as a development dependency.
Installing that package links both `create-font` and `font` locally. Inside an
existing workspace, the initializer adds another font project without replacing
the workspace or reinstalling its dependencies:

```sh
bun create-font display-font
```

The application runs on the Bun version pinned by the repository's
`mise.toml`. Its command-line interface is defined with `comline`; its
interactive server is an Elysia application; and
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
default master. Pass `--no-install` to defer the initial `bun install`.

`font build [name]` validates the selected directory source, projects it through
the editor compiler, and emits a deterministic variable TrueType font. Outputs
stay outside canonical source below
`artifacts/<project>/<PostScriptName>.ttf`; the command prints the absolute
artifact path on success. The file is replaced atomically only after source
validation, target ingestion, and serialization complete.

```sh
bun font build workbench-sans
```

The target-v1 profile supports simple unhinted quadratic glyphs, complete
`gvar` point deltas, a Windows Unicode `cmap`, named instances, the required
13-table variable TrueType set, and optional `avar`. Composite glyphs,
OpenType Layout, color, vertical metrics, and instructions remain later
profiles.

`font dev [name]` starts the Elysia workspace process on loopback by default. It
discovers `fonts/*/create-font.json`, selects the sole project automatically, and
serves its validated source units through the workspace RPC. With multiple font
projects, select one by directory name:

```sh
bun font dev workbench-sans --port=4173
```

`font serve` remains an alias for `font dev`.

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
deliberate boundary. Bun runs the Elysia HTTP and WebSocket API with runtime
`--hot` on port 3001. Vite serves `public/index.tsx` on port 3000 with Preact and
CSS HMR. Vite aliases the editor browser entry to its workspace source and
proxies `/api`, including WebSocket upgrades, to Bun, so editor changes retain
HMR without requiring a package build. Production emits only the bootstrap
under `dist/public`; the editor implementation remains in the dependency
package instead of being duplicated there.
