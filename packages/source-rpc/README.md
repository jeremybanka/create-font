# @create-art/source-rpc

`@create-art/source-rpc` is the product-neutral boundary between an editor and
a directory-backed source workspace.

It provides:

- revisioned manifests, coherent snapshots, and ordered change events;
- conditional create, replace, and remove transactions with idempotency keys;
- bounded, byte-preserving binary asset streams with deterministic SHA-256
  identity;
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

## Binary assets

Binary assets are an optional capability, separate from the JSON service. A
codec that opts in identifies canonical binary paths and extracts asset
descriptors from a validated JSON inventory. Each descriptor owns a stable ID,
safe source path, media type, byte length, and `sha256:` digest.

Uploads are streamed into expiring operation-scoped staging, with declared
length, per-asset, project, and digest checks applied before commit. A staged
asset becomes canonical only through `writeAssets()`, which journals the asset
create, conditional replacement, or conditional removal together with the JSON
inventory and reference writes. Failed or interrupted work is rolled back
without publishing a change event.

```ts
const source = await createFileSystemSourceService(root, assetAwareCodec, {
	maximumAssetBytes: 64 * 1024 * 1024,
	maximumProjectAssetBytes: 512 * 1024 * 1024,
})
const rpc = createSourceRpc({ assets: source, source })
```

The RPC uses raw request and response streams for asset bytes; base64 JSON is
never part of the asset transport. JSON-only codecs and servers can omit the
asset capability and retain their existing response shapes.
