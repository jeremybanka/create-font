# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

Following the [mise Node.js cookbook](https://mise.jdx.dev/mise-cookbook/nodejs.html#add-node-modules-binaries-to-the-path), mise adds the repository root’s `node_modules/.bin` to `PATH`. With shell activation or `mise exec -- <tool>`, installed dependency CLIs are available from the root and package directories.

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

`check:vp` runs Vite Plus linting and TypeScript checks; `check:fmt` handles formatting separately.

`check:vp` uses the generated package declarations. Run `pnpm build` first after a fresh checkout or package API changes; the aggregate `check` command already does this. CI restores the declarations from its Build job before running Vite Plus.

## Command notes

`test:watch` watches the Vitest suites; the Create Font app watches its unit suite. `cov` covers the font editor, matching the existing CI coverage surface. Rust formatting is included in `fmt` and checked by `check:rustfmt`.

## SPA canvas prototype

Run `pnpm dev:spa-canvas` to open the private SPA/Konva experiment. Pass Vite options directly, for example `pnpm dev:spa-canvas --port=5175 --strictPort`.

The two canvases load validated snapshots of `fonts/workbench-sans` and `designs/create-design-logo` into the existing editor state graphs. Drag outlines, anchors, and Bézier handles; switch font glyphs and masters; scroll to zoom; drag empty canvas space to pan. Undo and redo use the existing document timelines. Edits stay in memory; reload or **Reset sample** restores the fixtures. Editing a design primitive's nodes converts it to a path.

The prototype uses `@atom.io/spa/vite` and `@atom.io/spa/konva` directly. Component setup runs once; accessors inside compiled JSX update DOM and scene props. Store selection happens at each `render` root. Family-bound helpers such as glyph history need a reactive child collection with keys when the selected family member changes; a live `key` prop alone does not replace an instance. Stage sizing and accessible labels belong on a surrounding DOM element, since SPA's Stage forwards scene props to Konva. Native DOM events and callback refs replace React events and object refs; DOM styles use CSS strings.

This validates the canvas boundary, without changing either production editor. The experiment renders paths and basic fill/stroke paint. Text, images, linked artboards, clipping, advanced appearance, production tools, and persistence remain outside its scope. A full port also needs live prop access instead of setup-time destructuring, atom-backed component state, lifecycle cleanup, and replacements for React-only controls and icons.

Build and test it with `pnpm --filter @create-art/spa-canvas-prototype build` and `pnpm --filter @create-art/spa-canvas-prototype test`. The workspace `build`, `check`, and `test` commands include the prototype. It is private and creates no published package release delta.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.

## Unused code

Run `pnpm run check:unused` to check workspace files, exports, types, and dependencies. Run `pnpm run check:unused:production` to check production entrypoints without tests, examples, or contributor scripts keeping source code reachable. Both commands participate in `check` and run sequentially in a dedicated Knip CI job alongside the other static checks. Findings fail the check; neither command deletes code.

`knip.ts` preserves published entrypoint exports and accounts for executable configuration, workers, examples, and fixture projects. Review findings against public API and dynamically loaded inputs before removing code; source reachability does not measure final bundle size.
