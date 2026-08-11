---
"@create-design/editor": patch
"@create-design/model": patch
"@create-design/pdf": patch
"@create-design/png": patch
"@create-design/source": patch
"@create-design/svg": patch
---

Preserve open create-design contours losslessly while deriving straight fill closure independently from open stroke topology, including Pathfinder and SVG/PDF/PNG output parity. Pen drafts now finish open on Enter, double-click, or a tool switch, retain same-frame Bézier handle drags when pointer capture ends before pointer-up reaches the canvas, and Direct Selection deletes nodes by splitting their surviving runs instead of deleting the complete object.
