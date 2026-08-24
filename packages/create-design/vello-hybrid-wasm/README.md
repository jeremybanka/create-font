# `@create-design/vello-hybrid-wasm`

Rust/Wasm bindings for Create Design's experimental Vello Hybrid renderer. The
binding sends a whole typed scene packet per frame to Rust, where paths are
preprocessed on the CPU and rasterized by Vello Hybrid's WebGL2 backend.

This package does not upload a CPU-rendered framebuffer. Its browser API owns a
WebGL2 context on the supplied canvas and submits Vello draw operations directly
to that context.

The first editor integration renders solid vector fills and strokes only when
the complete visible paint stack is supported. Text, images, linked artboards,
masks, dashed strokes, and unsupported artboard colors trigger a whole-scene
Konva fallback so DOM canvas stacking cannot silently change paint order.
