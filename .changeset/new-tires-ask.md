---
"@create-font/states": minor
---

Keep editor projections current for direct transactions and isolate point geometry updates. Whole-document replacement now uses `actions.load` exclusively so it can reset glyph and kerning histories safely, with an optional transaction-scoped co-write for one caller-owned atom.
