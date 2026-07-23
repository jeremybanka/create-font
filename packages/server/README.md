# @create-font/server

`@create-font/server` owns the Elysia RPC contract for one create-font workspace and
the matching Eden client type. It deliberately does not own the editor assets:
the consumer `create-font` package composes this RPC with the application exported
by `@create-font/editor`.

Source JSON is exposed as individually addressable units:

- `GET /api/source/snapshot` reads one revision-consistent project snapshot;
- `GET /api/source` lists available units and their revisions;
- `GET /api/source/unit?path=…` reads one unit;
- `PUT /api/source/unit` writes one unit with a required idempotency key and an
  explicit expected revision (`null` means create); and
- `PUT /api/source/units` atomically writes one or more coordinated units; and
- `WS /api/source/events` publishes ordered revision transitions containing
  only changed unit snapshots and removed paths.

The unit path is the cache identity used by `@create-font/states`.
`@create-font/source` defines the concrete directory layout and per-file schemas.
The `create-font` application supplies a filesystem implementation that validates
the complete project before committing a write.

`createFontRpc` accepts an Elysia runtime adapter from its host application. The
adapter must be supplied before the RPC plugin is constructed because Elysia
registers WebSocket routes through the active adapter. The `create-font` host
selects Elysia's Bun adapter under Bun and its official Node adapter under Node.

The server is the synchronization authority. A client applies an event only
when its current revision equals the event's `previousRevision`; otherwise it
recovers through the snapshot route. An optional operation ID lets a writing
client deduplicate its own broadcast. The contract remains independent of the
filesystem implementation.

Reads report missing units as `source.unit_not_found`. Writes use optimistic
concurrency and report stale revisions as `source.revision_conflict`, including
both expected and actual revisions. Multi-unit write responses include both the
previous and committed project revisions so clients can detect intervening,
non-overlapping writes without conflating their local edit base with the latest
server revision.
