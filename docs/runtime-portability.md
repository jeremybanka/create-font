# Runtime portability

create-font supports Node and Bun as installed runtime choices, with Node as the
compatibility baseline. Runtime portability is separate from the RPC framework:
changing Elysia/Eden would not replace build, test, process, file, or CLI APIs
on its own.

## Portability boundary

The workspace is divided into four dependency classes:

| Class                  | Current boundary                                                               | Portability plan                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Installed runtime      | `packages/create-font/src`                                                     | Use Node-compatible and Web-standard APIs. Process execution goes through the injectable `RuntimeAdapter`. |
| Browser build          | `packages/create-font/scripts/build.ts` and `packages/font-editor/scripts/build.ts` | Vite builds application pages, the editor artifact, and published library entrypoints under Node.          |
| Tests                  | `packages/create-font/tests`                                                   | Vitest runs the behavioral suite under Node; a shared runtime smoke script also runs under Bun.            |
| Repository development | `packages/create-font/scripts/dev.ts` and package scripts                      | Node supervises the watched Elysia backend and Vite development server.                                    |

The source and application contracts are already runtime-neutral:

- `CreateFontSourceService` owns snapshots, revision-guarded writes, ordered
  source events, and optional Git operations without naming a host runtime.
- `createFontRpc` accepts an injected source service.
- `createFontServerApp` composes the Elysia application without starting a
  process.
- `RuntimeAdapter` is the narrow boundary for child processes. Its default
  implementation uses Node's child-process API, which Bun also implements.

Filesystem persistence uses `node:fs`, `node:path`, and `node:crypto`. These APIs
form the Node compatibility baseline and are supported by Bun; the persistence
core no longer calls the Bun global.

## Phase-one decisions

The first portability phase removes Bun globals from installed runtime source:

- CLI arguments come from `process.argv`, and published executables use the Node
  shebang.
- Git and package-manager processes use the shared runtime adapter.
- production assets use `node:fs` and Web `Response` objects instead of
  `Bun.file`.
- workspace installation invokes an explicit package manager. `npm` is the
  default, and callers can choose `npm`, `pnpm`, `yarn`, or `bun`.

## Phase-two decisions

The second portability phase gives the installed server a Node execution path:

- Elysia uses its native Bun adapter when the Bun global is present and loads
  the official `@elysia/node` adapter otherwise.
- the selected adapter is passed to the application and RPC plugin before
  routes are registered, so the HTTP and WebSocket contracts are identical.
- the Node adapter lifecycle is normalized to preserve Elysia's `app.server`
  and `app.stop()` behavior.
- a Node integration test covers HTTP, production editor assets, two-client
  source-event propagation, disconnect cleanup, and reconnect delivery.

## Build, test, and development decisions

The portability work is complete across the repository workflow:

- Vite replaces `Bun.build` for the editor library, application pages, browser
  RPC client, and published CLI/server entrypoints.
- Vitest runs every `create-font` behavioral test. Test fixtures use Node child
  processes and standard filesystem APIs.
- Node's watch mode runs the TypeScript backend while a Node child process runs
  the Vite development server.
- the primary CI job builds and tests with the tools declared in `mise.toml`,
  which no longer installs Bun.
- a separate compatibility job installs Bun explicitly, runs the same
  HTTP/assets/two-client/reconnect server smoke test through Elysia's native Bun
  adapter, and executes the built font CLI.

Node is the compatibility baseline. Bun remains a supported host for the
published CLI and server, but it is not required to install, initialize, edit,
persist, build, test, or use version-control features with create-font.

## RPC transport

Elysia and Eden remain the RPC framework. The Node and Bun adapters pass the
same runtime behavior test, so changing frameworks would not improve runtime
portability. A test-only tRPC standalone/SSE prototype verifies query, mutation,
two-client delivery, disconnect cleanup, and tracked reconnect input. The
measured surface and decision are documented in
[RPC transport decision](rpc-transport-decision.md).
