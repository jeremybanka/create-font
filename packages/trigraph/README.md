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
The composed application accepts a source-service implementation, allowing the
directory manager to be attached without introducing a server-to-states
dependency.

## Current commands

`trigraph build` enters the shared build orchestration boundary. The project
source format and binary serializer are not implemented yet, so it currently
returns a structured `build.not_implemented` diagnostic rather than claiming
to have emitted a font.

`trigraph serve` starts the Elysia workspace process on loopback by default.
The initial RPC exposes health, workspace identity, and the same preliminary
build operation used by the CLI. The same process serves the editor through
Elysia's Bun full-stack static plugin.

```sh
pnpm exec trigraph serve --port=4173
```

## Editor application boundary

The consumer package owns `public/index.html` and `public/index.tsx`. Its browser
entry imports `EditorApplicationRoot` from the private `@trigraph/editor`
workspace package and mounts it with Preact.

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
