# @create-art/realtime

`@create-art/realtime` is the product-neutral LAN collaboration foundation for
create-* applications. It provides typed Socket.IO action and presence
contracts, optimistic client replay, a persist-before-confirm authoritative
server, credential-backed device identities, signed identity claims, process-local
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

Presence coordinates belong to the product-defined document space, never to a
browser window. Products identify that space through `context`, project the
cursor and optional live `selectionBox` through each viewer's own viewport,
and use the opaque `selection` identities to render product-native highlights.

Public identity is a runtime boundary: `publicIdentity` copies only the device
ID, name, email, and public key, and admission stores detached public identities.
Never serialize a credential-store entry or authentication session wholesale.
Only the dedicated invitation, admission-poll, and authentication exchanges may
carry their intended recipient's temporary bearer credentials; participant and
session-status responses never carry signing keys or session tokens.

The authority projects participant, action, and snapshot envelopes onto their
public fields and replaces thrown exception diagnostics with fixed public
messages. Presence is reconstructed at every nested geometry boundary. Register
the application's public `presenceContextKeys` explicitly; the default publishes
no context fields. `projectCommand` can construct the application's public command
payload after `validateCommand` accepts it.

`Source`, `Command`, and registered presence context values are deliberately
public application data. Their contents must come from the application's
document schema, never from a credential store, environment, config object, or
internal service object. This transport cannot distinguish a secret pasted into
user-authored document text from ordinary document text. Envelope projection is
not a substitute for validating and constructing those product-owned payloads.
