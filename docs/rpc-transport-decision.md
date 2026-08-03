# RPC transport decision

## Decision

create-font retains Elysia and Eden for its workspace contract. Elysia's Bun
and Node adapters now pass the same HTTP, asset, two-client event fan-out,
disconnect-cleanup, and reconnect tests. Migrating the contract to tRPC would
change the public client and subscription transport without removing any
remaining Bun dependency.

The decision can be revisited if Elysia's adapters stop meeting the behavioral
contract or if create-font needs an SSE-specific capability that offsets the
migration cost.

## Measured current surface

The production workspace boundary currently contains:

- 11 Elysia routes in `packages/font-server/src/rpc.ts`: three general HTTP
  operations, seven source HTTP operations, and one source-event WebSocket;
- one 11-line Eden client factory in `packages/font-server/src/client.ts`; and
- seven typed Eden call sites in the 640-line browser bootstrap.

The runtime smoke test executes the shipped contract under Node and Bun. It
checks health and production assets, delivers one ordered event to two clients,
observes subscription cleanup after disconnect, reconnects a client, and
delivers the next event to both clients.

## tRPC prototype

`packages/font-server/tests/trpc-prototype.test.ts` is an executable, test-only tRPC
11 prototype using its standalone Node HTTP adapter and SSE subscriptions. Its
166 lines include the router, server lifecycle, raw HTTP/SSE clients, and test
harness. It demonstrates:

- a validated query and mutation;
- one event delivered to two SSE clients;
- listener cleanup after a client disconnects; and
- a tracked event ID arriving as `lastEventId` on reconnect.

The prototype confirms that tRPC is viable. It also makes the migration boundary
concrete: all 11 procedures must be rewritten, the Eden factory and seven
browser call sites must change, error/status mapping must move to tRPC errors,
and the WebSocket reconnect loop must become an SSE client. The standalone
adapter is Node-specific, so preserving Bun would also require a second tRPC
host adapter or a shared Fetch host. The prototype stays a development
dependency and is not included in published packages.

## Comparison

| Criterion                   | Elysia/Eden                                               | tRPC prototype                                                 |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Node HTTP and subscriptions | Passed with `@elysia/node` and WebSockets                 | Passed with the standalone adapter and SSE                     |
| Bun host                    | Passed with Elysia's native adapter                       | Not provided by the standalone Node adapter                    |
| Two-client propagation      | Passed                                                    | Passed                                                         |
| Disconnect cleanup          | Passed                                                    | Passed                                                         |
| Reconnect identity          | Existing revision-gap recovery; tested reconnect delivery | `tracked()` supplies `lastEventId`; prototype verifies receipt |
| Runtime validation          | Existing TypeBox schemas and typed status responses       | Zod inputs; error/status mapping requires a rewrite            |
| Migration size              | No production transport changes                           | 11 routes, one client factory, and seven browser call sites    |

tRPC recommends SSE when a subscription is server-to-client only and its
tracked events can carry reconnect IDs. Those are useful properties, but the
current ordered-delta protocol already detects gaps and reloads an atomic
snapshot after reconnect. The prototype therefore does not show a behavioral
gain large enough to justify changing the public transport now.

## References

- [tRPC standalone adapter](https://trpc.io/docs/server/adapters/standalone)
- [tRPC subscriptions and tracked events](https://trpc.io/docs/server/subscriptions)
- [tRPC HTTP subscription link](https://trpc.io/docs/client/links/httpSubscriptionLink)
