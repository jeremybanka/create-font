# Runtime portability

create-font supports Node and Bun as runtime choices in principle, with Node as
the compatibility baseline. Runtime portability is separate from the RPC
framework: changing Elysia/Eden would not replace build, test, process, file, or
CLI APIs on its own.

## Portability boundary

The workspace is divided into four dependency classes:

| Class                  | Current boundary                                                               | Portability plan                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Installed runtime      | `packages/create-font/src`                                                     | Use Node-compatible and Web-standard APIs. Process execution goes through the injectable `RuntimeAdapter`. |
| Browser build          | `packages/create-font/scripts/build.ts` and `packages/editor/scripts/build.ts` | Replace `Bun.build` with the Vite toolchain in the build-portability phase.                                |
| Tests                  | `packages/create-font/tests`                                                   | Move `bun:test` suites and Bun-only fixtures to Vitest in the test-portability phase.                      |
| Repository development | `packages/create-font/scripts/dev.ts` and package scripts                      | Replace direct Bun orchestration after the Node server entry point exists.                                 |

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

This phase intentionally does not claim a complete Node execution path.
Elysia server startup still uses its current Bun adapter, browser bundles still
use `Bun.build`, and the create-font application tests still use `bun:test`.
Those are isolated follow-up phases rather than hidden dependencies of the
source-service contract.
