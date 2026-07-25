---
"create-design": patch
"@create-font/editor": patch
"@create-font/preact-konva": patch
"@create-font/states": patch
"create-font": patch
---

Add shared authoritative vector gesture state machines and interactive scene components for font and design editing, including complete Pen drafts, Bézier handles, cancellation, shape placement, selection, and coordinate-correct transforms in both y-up and y-down canvases. Keep create-design persistence and history in its document adapter while deferring its Rule tool, and preserve create-font's responsive native Pen transactions and unselected preview marker. Add an issue-linked create-font tool itinerary, mounted interaction-lifecycle regressions, and CI-enforced Vitest coverage floors for the font-tool surface. Keep Pen commits responsive by using shallow revision dependencies for mounted font projections, compiling live fonts only while a Preview tile is present, and coalescing whole-source persistence after an edit burst. Restore Shift-marquee selection inversion so every covered node or handle toggles its prior selection state, fully select pasted contours including their authored handles, and keep selected-contour fills, outlines, nodes, and screen-constant selection rings aligned with the pointer while controlled Konva nodes rerender. Let the full-width invisible edge hit target initiate the same selected-contour drag as the visible stroke.
