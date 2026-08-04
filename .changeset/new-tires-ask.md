---
"@create-font/states": minor
---

Keep editor projections current for direct transactions and isolate point geometry updates. Whole-document replacement now uses `actions.load` exclusively so it can reset glyph and kerning histories safely, with an optional transaction-scoped tuple of validated caller-owned atom co-writes.
