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

`font build [name]` enters the shared build orchestration boundary. The project
source format and binary serializer are not implemented yet, so it currently
returns a structured `build.not_implemented` diagnostic rather than claiming
to have emitted a font.

`font dev [name]` starts the Elysia workspace process on loopback by default. It
discovers `fonts/*/create-font.json`, selects the sole project automatically, and
serves its validated source units through the workspace RPC. With multiple font
projects, select one by directory name:

```sh
bun font dev create-font-sans --port=4173
```

`font serve` remains an alias for `font dev`.

Reads carry content-hash revisions. Single- and multi-unit writes use
optimistic concurrency, idempotency keys, whole-project validation, and a
transaction journal so coordinated entity/index edits either commit together
or roll back.

## Editor application boundary

The consumer package owns `public/index.html` and `public/index.tsx`. Its browser
entry imports `EditorApplicationRoot` from `@create-font/editor`
workspace package, loads the selected project's source units through Eden,
assembles them into editor state, and persists changed units back through the
multi-write route. It uses the browser-only `@create-font/source/browser`
entrypoint, leaving Zod schemas and per-unit validation in the server process.

The Elysia server awaits `@elysia/static` with `bunFullstack: true` and serves
that application at `/`. Bun therefore owns TypeScript/JSX and CSS bundling,
CSS Modules, and the same-origin application/API development server; Vite is
not part of the serving path.

Development runs use `public/index.tsx` directly so Bun can follow the
`@create-font/editor` workspace export. The package build emits a self-contained
HTML, JavaScript, and CSS application under `dist/public`, which is what the
compiled server serves after installation.

Bun 1.3.14's HMR transform omits CSS Module bindings from generated client
chunks. `font dev` therefore keeps Bun's full-stack runtime bundling
active but sets `hmr: false` until that regression is fixed.
