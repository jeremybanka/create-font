# @create-art/source-format

## 0.2.12

### Patch Changes

- a760670: Support dprint 0.61 as an optional peer and report 0.61.1 as the workspace's
  reference CLI in exported compatibility metadata.

## 0.2.11

### Patch Changes

- 0af0a7e: Update the pinned JSON formatter to `@dprint/json` 0.25.2, which preserves
  untouched `package.json` property order during range formatting. Report the
  matching version through `SOURCE_FORMAT_JSON_PLUGIN_VERSION`. Canonical
  whole-file source formatting remains unchanged.

## 0.2.10

### Patch Changes

- dec6f2b: Support dprint 0.59 and 0.60 as optional peers and report 0.60.1 as the workspace's
  reference CLI in exported compatibility metadata.

## 0.2.9

### Patch Changes

- 07fd260: Update the pinned JSON formatter to `@dprint/json` 0.25.1 and report the matching
  version through `SOURCE_FORMAT_JSON_PLUGIN_VERSION`.

## 0.2.8

### Patch Changes

- 1b29078: Support dprint 0.58 in the optional peer range and exported compatibility metadata.

## 0.2.7

### Patch Changes

- 5361432: Update the pinned JSON formatter to `@dprint/json` 0.25.0 and report the
  matching version through `SOURCE_FORMAT_JSON_PLUGIN_VERSION`. Canonical
  font and design JSON output remains unchanged.

## 0.2.6

### Patch Changes

- ea25f19: Correct public TypeScript contracts for browser source formatting, request bodies, stroke diagnostic arrays, legacy design migration, and discriminated font outline commands.
  
  Design directory assembly now returns a missing-file diagnostic for a missing project manifest alongside inline text. Direct SVG export reports an actionable error when a linked artboard has not been expanded.

## 0.2.5

### Patch Changes

- c4f9719: Upgrade the trusted JSON formatter to @dprint/json 0.24 and apply its package.json field-order conventions.

## 0.2.4

### Patch Changes

- 33c891f: Update the workspace's validated dprint reference to 0.57.4 without changing the compatible peer range or formatting contract.

## 0.2.3

### Patch Changes

- 0394bb1: Update the workspace's validated dprint reference to 0.57.1 without changing the compatible peer range or formatting contract.

## 0.2.2

### Patch Changes

- 31b7b49: Support dprint 0.57 while preserving the existing source-format byte contract.

## 0.2.1

### Patch Changes

- 20375fa: Update the workspace's validated dprint reference to 0.56.1 without changing the compatible peer range or formatting contract.

## 0.2.0

### Minor Changes

- 1032c7c: Accept dprint 0.55.2 and 0.56.x as an optional peer for the published lexical
  configuration while keeping canonical source formatting on contract version 1.

## 0.1.2

### Patch Changes

- c852f02: Declare the repository's MPL library boundary and AGPL application boundary, with explicit permissions for generated assets.
- Updated dependencies [c852f02]
  - dprint-plugin-fea@0.1.2

## 0.1.1

### Patch Changes

- 0d59cb3: Format canonical create-font and create-design source with the pinned,
  published dprint contract before hashing and persistence, and expose matching
  `create-source-format` fmt/check workflows for users, editors, and CI.
