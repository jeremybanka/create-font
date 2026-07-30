# @create-art/source-rpc

`@create-art/source-rpc` is the product-neutral boundary between an editor and
a directory-backed source workspace.

It provides:

- revisioned manifests, coherent snapshots, and ordered change events;
- conditional create, replace, and remove transactions with idempotency keys;
- browser synchronization primitives that detect duplicate events and gaps;
- a composable Elysia router and a small fetch client;
- a Node filesystem service with path confinement, full-candidate validation,
  transaction journals, and startup rollback.

The filesystem service is codec-driven. A product owns its source format and
supplies parsing, canonical formatting, and whole-workspace assembly. The
service owns concurrency and durability without knowing what the JSON means.

```ts
import { createFileSystemSourceService } from "@create-art/source-rpc/node"
import { createSourceRpc } from "@create-art/source-rpc/server"

const source = await createFileSystemSourceService(root, codec)
const rpc = createSourceRpc({ source })
```
