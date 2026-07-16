# @create-font/server

`@create-font/server` owns the Elysia RPC contract for one create-font workspace and
the matching Eden client type. It deliberately does not own the editor assets:
the consumer `create-font` package composes this RPC with the application exported
by `@create-font/editor`.

Source JSON is exposed as individually addressable units:

- `GET /api/source` lists available units and their revisions;
- `GET /api/source/unit?path=…` reads one unit;
- `PUT /api/source/unit` writes one unit with a required idempotency key and an
  explicit expected revision (`null` means create); and
- `PUT /api/source/units` atomically writes one or more coordinated units.

The unit path is the cache identity used by `@create-font/states`.
`@create-font/source` defines the concrete directory layout and per-file schemas.
The `create-font` application supplies a filesystem implementation that validates
the complete project before committing a write.

The server is intentionally chatty. A glyph, axis, instance, or other loadable
can issue its own request; there is no aggregate query endpoint or tactical
frontend loader. The contract remains independent of the filesystem
implementation.

Reads report missing units as `source.unit_not_found`. Writes use optimistic
concurrency and report stale revisions as `source.revision_conflict`, including
both expected and actual revisions.
