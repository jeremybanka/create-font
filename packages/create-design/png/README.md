# @create-design/png

Deterministic PNG projection for create-design documents. The package contains
no DOM, Node built-in, native binary, timestamp, or random input, so the exact
same API runs in a browser worker and in noninteractive Node.

```ts
const result = await exportPng(document, {
	scope: { kind: "active", artboardId: "artboard:page" },
	scale: 2,
	background: { kind: "transparent" },
})
```

## Pixel contract

- Output dimensions are `max(1, round(artboard dimension × scale))`.
- Pixel centers are mapped evenly across the exact artboard rectangle; artwork
  is clipped at that rectangle.
- The reference backend uses a fixed ordered 4 × 4 subpixel grid. Set `samples`
  to 1 or 2 when explicitly trading edge quality for throughput.
- Paint follows document scene order, with fill before stroke. Hidden artwork
  is omitted. CMYK colors use the same deterministic sRGB alternate as SVG.
- Valid live contour blends are lowered through the shared model projection;
  incompatible blends block output with the shared blend diagnostics.
- Color and alpha use half-up 8-bit rounding. Partially covered transparent
  pixels are accumulated premultiplied and stored as straight RGBA.
- Encoding is RGBA8, non-interlaced, filter 0, and deterministic stored-DEFLATE.
  Only `IHDR`, `IDAT`, and `IEND` are emitted; timestamps and ancillary metadata
  are intentionally absent.

The stable `PngRasterBackend` interface keeps orchestration independent of the
reference renderer. A future accelerator must pass the byte, decoded-pixel,
browser-worker, Node, lifecycle, and benchmark suites before becoming default.

## Rasterizer appraisal

The initial implementation deliberately has no outside rasterizer. Native and
WASM SVG engines offer higher throughput, but add platform binaries or WASM,
browser/Node loading differences, a larger bundle, a second SVG interpretation
layer, and additional license/provenance review. Canvas APIs are browser-only
and vary by engine; native canvas and image libraries are not worker-portable.
The pure TypeScript backend is MPL-compatible with this package, auditable from
the repository, and produces identical bytes in every runtime. Its known cost
is CPU time on large or high-scale artboards, so live proof is opt-in,
debounced, cancellable, and yields between row batches.

Run `pnpm --filter @create-design/png run profile` for repeatable cold, warm, batch,
and retained-heap measurements.
