---
"@create-art/editor": patch
"@create-art/preact-konva": minor
"@create-design/editor": patch
"@create-design/model": patch
"@create-design/pdf": patch
"@create-design/source": patch
"@create-font/editor": minor
"create-design": patch
"create-font": patch
---

Separate the create-design browser editor from its CLI and server package,
move shared editor foundations under create-art ownership, and make font-owned
package directories explicit throughout the workspace. Move the product-neutral
Preact Konva bindings from create-font ownership to create-art ownership. Put
canonical document initialization in the source package and extract headless
design-model and PDF packages for browser and CLI consumers.
