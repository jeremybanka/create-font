# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

| Command           | Contract                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `fmt`             | Apply the repository formatting policy.                                                                            |
| `check:fmt`       | Validate formatting without rewriting maintained files; language-specific validators are listed below.             |
| `check`           | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit. |
| `test`            | Run the normal test suite once and return a failing status when tests fail.                                        |
| `test:watch`      | Watch the available interactive test suites.                                                                       |
| `build`           | Build distributable artifacts.                                                                                     |
| `change`          | Author pending release notes.                                                                                      |
| `release:version` | Prepare versions and release metadata without publishing.                                                          |
| `release:publish` | Build as required by the release pipeline and publish packages.                                                    |
| `cov`             | Run instrumented tests and generate local coverage reports.                                                        |

## Static checks

- `check:agents`: `agents validate`.
- `check:clippy`: `mise exec -- cargo clippy --workspace --all-targets -- -D warnings`.
- `check:eslint`: `pnpm -r check:eslint`.
- `check:fmt`: `vp run dprint-plugin-fea#build && node ./packages/create-art/source-format/src/cli.ts check fonts designs && dprint check`.
- `check:lasertag`: `pnpm -r check:lasertag`.
- `check:vp`: `vp check --no-fmt`.
- `check:peers`: `pnpm peers check`.
- `check:rustfmt`: `mise exec -- cargo fmt --all -- --check`.

`check:vp` invokes the configured Vite Plus validation pipeline; `check:fmt` handles formatting separately.

## Command notes

`test:watch` watches the Vitest suites; the Create Font app watches its unit suite. `cov` covers the font editor, matching the existing CI coverage surface. Rust formatting is included in `fmt` and checked by `check:rustfmt`.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
