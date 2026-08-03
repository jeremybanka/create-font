---
"@create-art/editor": patch
"preact-konva": minor
"@create-design/editor": patch
"@create-design/model": patch
"@create-design/pdf": patch
"@create-design/source": patch
"@create-font/editor": minor
"@create-font/fea-rs-wasm": patch
"create-design": patch
"create-font": patch
---

Separate the create-design browser editor from its CLI and server package,
move shared editor foundations under create-art ownership, and make font-owned
package directories explicit throughout the workspace. Move the product-neutral
Preact Konva bindings into a product-neutral unscoped package. Put
canonical document initialization in the source package and extract headless
design-model and PDF packages for browser and CLI consumers. Keep the
fea-rs-wasm build and benchmark scripts runnable from their scoped directory.
