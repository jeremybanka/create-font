# create-font workspace

- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`,
  `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript
  directly.
- PRs that ship a feature or user-visible fix in an npm package must include a
  `.changeset/*.md` file naming every affected package and the appropriate
  semantic-version bump. Run `pnpm change` when authoring the changeset.

Consult `./agents.yaml` when working with outside dependencies.
