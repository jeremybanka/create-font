---
"@create-font/editor": patch
"create-design": patch
---

Add shared tile control primitives and split create-design's Object, Transform,
and Arrange inspectors into focused tiles. Keep their control layouts stable
across selection states, use disabled controls for unavailable actions, and use
a single pressed-button treatment for constrained proportions.
