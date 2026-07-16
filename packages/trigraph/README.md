# trigraph

`trigraph` is the repository-local application package for the Trigraph font
toolchain. It is intended to be installed as a development dependency and run
with the repository's package manager:

```sh
pnpm exec trigraph build
pnpm exec trigraph serve
```

The application runs on Bun canary. Its command-line interface is defined with
`comline`; its interactive server is an Elysia application; and
`trigraph/rpc-client` exposes the corresponding Eden Treaty client factory.

## Current commands

`trigraph build` enters the shared build orchestration boundary. The project
source format and binary serializer are not implemented yet, so it currently
returns a structured `build.not_implemented` diagnostic rather than claiming
to have emitted a font.

`trigraph serve` starts the Elysia workspace process on loopback by default.
The initial RPC exposes health, workspace identity, and the same preliminary
build operation used by the CLI.

```sh
pnpm exec trigraph serve --port=4173
```

## Editor integration boundary

This package declares `@trigraph/editor` as a workspace development dependency
because the consumer application will own and bundle the browser entrypoint.
No editor code is imported yet: `@trigraph/editor` is currently a self-starting
private Vite application without an exported mount function or Bun-compatible
asset entrypoint.

The next integration step will require changing the editor package to expose a
browser module that this application can import alongside
`createTrigraphRpcClient`. That editor change is deliberately outside this
preliminary scaffold.
