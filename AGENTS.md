# create-font workspace

- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`,
  `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript
  directly.
- PRs that ship a feature or user-visible fix in an npm package must include a
  `.changeset/*.md` file naming every affected package and the appropriate
  semantic-version bump. Use a minor bump for breaking changes while the
  package is pre-v1; use a patch bump for features and fixes. Run `pnpm change`
  when authoring the changeset.

Consult `./agents.yaml` when working with outside dependencies.

## Secrets are not configuration

This is a mandatory security boundary for every Create-* application, package,
script, and test. File permissions, encryption, an ignored path, or a local-only
deployment do not turn credentials into configuration.

- Never store secret values in project, application, or user configuration;
  `.env` files; serialized settings; or configuration examples. This includes
  private signing keys, passwords, access and refresh tokens, bearer/session
  credentials, and encrypted secret blobs. Configuration may contain only
  non-secret provider choices and credential references, never the credentials
  or the secret needed to unlock their store.
- Persist credentials only through an explicit operating-system credential
  store or approved secret-management provider. Do not implement credential
  storage as an application-managed file, database, or configuration adapter.
  Never fall back to filesystem storage when a provider is missing, locked, or
  unavailable. A `0600` file is not an acceptable fallback.
- Headless operation must document and use an explicitly provisioned credential
  provider. If it cannot securely access that provider, fail the operation that
  needs credentials with actionable, secret-free diagnostics. Do not create an
  unprotected keyring, embed an unlock password, or silently generate a new
  persistent identity to make startup succeed.
- Keep secret retrieval inside narrowly scoped credential capabilities, such
  as a signing service. Expose public identity and operations to application
  code; never return a composite identity object carrying a private key. Keep
  secrets out of shared state, snapshots, presence, logs, errors, telemetry,
  generated artifacts, and debugging output.
- Construct protocol messages from explicitly allowlisted public fields. Never
  spread, forward, or serialize credential-bearing objects into a response or
  event. Validate outgoing messages at runtime and test serialization boundaries
  with synthetic secret markers, including nested fields and error paths.
  TypeScript types alone do not remove unexpected runtime properties.
- Send credentials only through a deliberately defined authentication exchange
  to their intended recipient, over an authenticated secure transport. Such an
  exchange does not authorize including credentials in general protocol
  payloads or broadcasting them to participants. Private signing keys remain
  within the credential/signing boundary and are never protocol payloads.
- Tests must use explicit in-memory credential fakes or isolated test providers
  and synthetic credentials. Never read a developer's real credentials or write
  test secrets to configuration. Do not add a production filesystem fallback
  for test convenience.
- When removing legacy secret-bearing configuration, treat potentially exposed
  credentials as compromised: rotate or revoke them through the credential
  provider and remove the obsolete secret storage. Do not copy a potentially
  disclosed key into the new provider and call the migration complete.
