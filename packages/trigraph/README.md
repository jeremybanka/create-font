# trigraph

`trigraph` is the repository-local application package for the Trigraph font
toolchain. It is intended to be installed as a development dependency and run
with the repository's package manager:

```sh
pnpm exec trigraph build
pnpm exec trigraph serve
```

The application runs on the Bun version pinned by the repository's
`mise.toml`. Its command-line interface is defined with `comline`; its
interactive server is an Elysia application; and
`trigraph/rpc-client` exposes the corresponding Eden Treaty client factory.
The reusable workspace routes and client typing live in `@trigraph/server`;
this package composes them with the editor application and CLI build handler.
The composed application discovers projects below `fonts/`, attaches the
filesystem source service, and hydrates the editor through the same Elysia/Eden
contract used for persistence. This keeps the server independent from the
atom.io implementation in `@trigraph/states`.

## Current commands

`trigraph build` enters the shared build orchestration boundary. The project
source format and binary serializer are not implemented yet, so it currently
returns a structured `build.not_implemented` diagnostic rather than claiming
to have emitted a font.

`trigraph serve` starts the Elysia workspace process on loopback by default. It
discovers `fonts/*/trigraph.json`, selects the sole project automatically, and
serves its validated source units through the workspace RPC. With multiple font
projects, select one by directory name:

```sh
pnpm exec trigraph serve --font=trigraph-sans --port=4173
```

Reads carry content-hash revisions. Single- and multi-unit writes use
optimistic concurrency, idempotency keys, whole-project validation, and a
transaction journal so coordinated entity/index edits either commit together
or roll back.

## Editor application boundary

The consumer package owns `public/index.html` and `public/index.tsx`. Its browser
entry imports `EditorApplicationRoot` from the private `@trigraph/editor`
workspace package, loads the selected project's source units through Eden,
assembles them into editor state, and persists changed units back through the
multi-write route. It uses the browser-only `@trigraph/source/browser`
entrypoint, leaving Zod schemas and per-unit validation in the server process.

The Elysia server awaits `@elysia/static` with `bunFullstack: true` and serves
that application at `/`. Bun therefore owns TypeScript/JSX and CSS bundling,
CSS Modules, and the same-origin application/API development server; Vite is
not part of the serving path.

Development runs use `public/index.tsx` directly so Bun can follow the
`@trigraph/editor` workspace export. The package build emits a self-contained
HTML, JavaScript, and CSS application under `dist/public`, which is what the
compiled server serves after installation.

Bun 1.3.14's HMR transform omits CSS Module bindings from generated client
chunks. `trigraph serve` therefore keeps Bun's full-stack runtime bundling
active but sets `hmr: false` until that regression is fixed.
