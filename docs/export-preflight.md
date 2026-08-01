# Export preflight contract

Export preflight is a runtime boundary over an already validated
`DesignDocument`. It does not parse canonical source, report persistence
conflicts, inspect recovery drafts, or make editable work invalid. Those source
and recovery responsibilities stay separate from output authorization.

`packages/create-design/src/export-preflight.ts` defines the portable contract.
Every diagnostic has a stable code, severity, target, capability, message, and
optional entity, artboard, and action data. Results contain only ordinary frozen
objects and arrays, so browser UI, workers, command-line integrations, and tests
can consume the same deterministic value without DOM or filesystem APIs.

An exporter adapter declares:

- its stable target identifier;
- the capability strings it currently preserves;
- any capability strings it explicitly approximates;
- how its target options resolve to ordered artboard output regions; and
- optional target-specific object inspectors.

Common preflight checks target coverage and model capabilities. The initial PDF
adapter declares ordinary paths, open-path fill and stroke semantics, live
rectangle and ellipse lowering, even-odd fill, RGB/CMYK paint, strokes, clipping,
and bleed. PDF scope mistakes are blocking errors. The optional
`common.artwork-outside-requested-artboards` lint reports an informational
notice when visible artwork extends outside the union of requested page regions;
artwork spanning multiple requested artboards is not reported when their union
covers it. Authored bleed participates only when requested. This lint is off by
default and its Export-tile toggle is ephemeral document UI state.

Only errors block output. Warnings and informational notices never require
confirmation and never suppress an artifact. The Export tile, live PDF compiler,
download manager, and noninteractive callers all consume
`preflightPdfExport`; low-level PDF projection remains an internal lowering
primitive rather than an authorization boundary.

Future SVG, text/font, asset, effect, and mask implementations should add their
own declared capabilities and inspectors when those model concepts exist. A
capability whose material cannot be represented is an error. A capability
listed in `approximatedCapabilities` is a warning. Normal supported semantics
produce no diagnostic. Optional quality or workflow advice is an opt-in lint
and is informational. Exporters must not add placeholder diagnostics for
entities absent from the current document schema. New diagnostics should
preserve the existing shape and append stable target-specific codes rather than
changing common fields or severity semantics. Tests for every new exporter must
cover omitted, approximated, supported, and opt-in advisory behavior, including
the guarantee that non-error diagnostics still produce output.
