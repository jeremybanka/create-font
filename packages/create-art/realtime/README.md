# @create-art/realtime

`@create-art/realtime` is the product-neutral LAN collaboration foundation for
create-* applications. It provides typed Socket.IO action and presence
contracts, optimistic client replay, a persist-before-confirm authoritative
server, persistent device identities, signed identity claims, process-local
admission, and certificate-pinned invitations.

The package deliberately does not define a document model. A product supplies
its own source snapshot, registered command union, command validator, and
durable persistence callback. The host remains the source of truth; clients
only submit those registered commands and recover from authoritative snapshots.

Entry points:

- `@create-art/realtime/client` — optimistic browser client and replay;
- `@create-art/realtime/server` — Socket.IO action and presence authority;
- `@create-art/realtime/node` — device identities, signed claims, invitations,
  and admission; and
- `@create-art/realtime` — shared protocol contracts.

The transport is built on `atom.io/realtime`. Integration tests use
`atom.io/realtime-testing` to run multiple isolated editor clients against one
authoritative host.
