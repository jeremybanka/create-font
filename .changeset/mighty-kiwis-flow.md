---
"@create-art/source-format": patch
---

Update the pinned JSON formatter to `@dprint/json` 0.25.2, which preserves
untouched `package.json` property order during range formatting. Report the
matching version through `SOURCE_FORMAT_JSON_PLUGIN_VERSION`. Canonical
whole-file source formatting remains unchanged.
