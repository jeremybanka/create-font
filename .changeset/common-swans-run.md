---
"@create-art/realtime": minor
"create-font": patch
---

Keep device signing keys in OS credential storage, exposing only public identity
and a signing capability. Require a persistent Secret Service provider on Linux,
fail closed when credentials are unavailable, and add explicit rotation that
replaces potentially disclosed legacy configuration keys before removing them.
