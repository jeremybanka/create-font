---
"@create-font/server": minor
"@create-font/states": minor
"create-font": minor
---

Add the revision-consistent `SourceProjectSnapshot` service contract and version
4 bulk snapshot RPC. Switch the editor SharedWorker to load and refresh every
validated source unit through one atomic snapshot request while preserving the
legacy manifest and individual-unit endpoints.

Add correlated browser, SharedWorker, and filesystem source-service startup
instrumentation, a reproducible profiling workflow, and measured development
and production baselines.
