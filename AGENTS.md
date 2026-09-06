# create-font workspace

## Source files and dependencies

Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.

Consult `./agents.yaml` when working with outside dependencies.

## Package changes

Changesets describe the user-facing delta between releases, not all work done. Every changeset must answer: “What will the user notice about this version in comparison to the most recently released version?”

Ensure user-visible package changes are covered by a `.changeset/*.md` file naming every affected package and the appropriate semantic-version bump. Update or consolidate pending changesets to describe the final released behavior; do not add separate fix changesets for features that have not shipped. Work with no user-facing release delta needs no changeset.

Use a minor bump for breaking changes while the package is pre-v1; use a patch bump for features and fixes. Run `pnpm change` when authoring a new changeset.

## Secrets are not configuration

Never store secrets or credentials in project, application, or user configuration, including `.env` files and encrypted secret blobs. Configuration may identify a provider or reference a credential, but must not contain its secret value. File permissions or encryption do not make a secret configuration.

Persist credentials through an OS credential store or an explicit secret-management provider. Headless instances must provision a secure provider too. If it is missing, locked, or unavailable, fail the operation that needs it with an actionable error; never fall back to an application-managed credential file or put the provider's unlock secret in configuration.
