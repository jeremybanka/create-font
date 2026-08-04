# @create-design/text

Canonical, runtime-portable shaping, line layout, diagnostics, and glyph-outline
projection for editable create-design text. Canvas, PDF, and Expand Text consume
the same `DesignTextLayout`; browser DOM measurement is never authoritative.

Typography edits apply to the whole object in the initial source model. Native
editing may select a range, but changing a typography control while a range is
selected intentionally promotes that value to the object. This avoids invisible
per-range state and is exposed in the editor as “Applies to text object.”

Live PDF text is deliberately lowered to cached glyph outlines. This preserves
determinism and avoids embedding fonts whose licensing flags or subset behavior
have not been verified. Missing fonts, missing glyphs, and unavailable outlines
are blocking diagnostics for PDF export and Expand Text.
