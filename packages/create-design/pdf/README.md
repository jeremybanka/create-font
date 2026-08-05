# @create-design/pdf

Headless PDF projection, preflight, incremental compilation, and serialization
for create-design documents. The browser editor consumes this package, and the
create-design CLI can use the same API without importing editor code.

Ready live contour blends lower to ordinary path streams in deterministic
paint order. Hidden blends are omitted. Blend warnings appear in PDF preflight;
incompatible or missing endpoints block preflight, and direct projection throws
`PdfBlendProjectionError` with the same recoverable diagnostics.

PDF has no editable create-design layer structure. Export therefore consumes
the shared model output projection: visible layers and nested groups flatten in
canonical back-to-front order, hidden-layer artwork is omitted, and locked
layers render identically to unlocked layers. Object and blend preflight
diagnostics include structured containing-layer identity when available.
