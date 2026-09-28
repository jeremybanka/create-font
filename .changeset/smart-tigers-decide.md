---
"create-font": patch
"create-design": patch
---

Update comline to 0.9.0 to remove the positional-input deprecation warning from native Nushell completion while preserving delegation to other completion providers. Native Nushell completion now requires Nushell 0.116.0 or newer. After upgrading, reinstall or regenerate existing native Nushell completion files with the updated CLI, then start a new shell.
