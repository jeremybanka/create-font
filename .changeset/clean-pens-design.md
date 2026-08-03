---
"@create-art/editor": patch
"@create-art/preact-konva": minor
"@create-design/editor": patch
"@create-font/editor": minor
"create-design": patch
"create-font": patch
---

Separate the create-design browser editor from its CLI and server package,
move shared editor foundations under create-art ownership, and make font-owned
package directories explicit throughout the workspace. Move the product-neutral
Preact Konva bindings from create-font ownership to create-art ownership.
