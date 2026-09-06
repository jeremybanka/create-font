# @create-art/source-format

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
