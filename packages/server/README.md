# @trigraph/server

`@trigraph/server` owns the Elysia RPC contract for one Trigraph workspace and
the matching Eden client type. It deliberately does not own the editor assets:
the consumer `trigraph` package composes this RPC with the application exported
by `@trigraph/editor`.

Source JSON is exposed as individually addressable units:

- `GET /api/source` lists available units and their revisions;
- `GET /api/source/unit?path=…` reads one unit;
- `PUT /api/source/unit` writes one unit with a required idempotency key and an
  explicit expected revision (`null` means create).

The unit path is the cache identity used by `@trigraph/states`.
`@trigraph/source` defines the concrete directory layout and per-file schemas;
a filesystem source service will connect those validators to these routes.

The server is intentionally chatty. A glyph, axis, instance, or other loadable
can issue its own request; there is no aggregate query endpoint or tactical
frontend loader. Source-service handlers will be backed by the directory
manager once that package's validators and layout are settled.

Reads report missing units as `source.unit_not_found`. Writes use optimistic
concurrency and report stale revisions as `source.revision_conflict`, including
both expected and actual revisions.
