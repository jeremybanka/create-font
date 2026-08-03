# Lasertag 0.6 ownership plan and implementation

Date: 2026-07-22

Scope: Renovate PR [#196](https://github.com/jeremybanka/create-font/pull/196),
now carrying `lasertag` 0.6.7.

## What changed in 0.6.6

Lasertag 0.6.6 resolves imported component roots from implementation evidence
in the TypeScript module graph. It no longer has to treat every imported
component as one undifferentiated opaque branch.

The ownership diagnostics now distinguish three situations:

- `selector-matches-foreign-component-root`: Lasertag resolved the imported
  component and proved that the selector addresses its outer root.
- `selector-crosses-ownership-boundary`: the selector can enter content below
  a resolved or asserted foreign root.
- `opaque-component-root-may-collide`: Lasertag could not prove the imported
  root and groups selectors that may collide with it.

This behavior landed primarily in
[Lasertag PR #164](https://github.com/jeremybanka/lasertag/pull/164). The
intervening [PR #156](https://github.com/jeremybanka/lasertag/pull/156) and
[PR #158](https://github.com/jeremybanka/lasertag/pull/158) reduce collateral
warnings from unrelated opaque sibling branches, while
[PR #162](https://github.com/jeremybanka/lasertag/pull/162) preserves warnings
when a local path and an opaque foreign path can genuinely overlap.

The practical compromise is better:

- use implementation evidence when it is available;
- use a tag-named assertion only for a stable intrinsic root that cannot be
  resolved;
- distinguish styling a foreign root from entering its internals;
- group uncertainty instead of emitting a cascade of speculative selector
  branches;
- fail conservatively when neither evidence nor an explicit assertion is
  available.

## Keep the `svg.*` assertions

The 0.6.2 migration remains useful:

```tsx
const svg = {
	MagnifyingGlass: MagnifyingGlassIcon,
}

<svg.MagnifyingGlass />
```

Radix Icons is declaration-only from Refractor's point of view in this
workspace. An in-memory comparison using direct `<MagnifyingGlassIcon />`
references produced `opaque-component-root-may-collide` diagnostics in every
affected component. The `svg.*` spelling is therefore still the clearest
available assertion that the foreign root is an SVG.

The assertion remains intentionally unchecked. It should be used only in the
small local maps whose values are visibly imported Radix icons. It must not be
used to relabel `EditorIcon`, `NumericInput`, or another custom-root component
as an SVG.

## Pre-implementation baseline

Run:

```sh
pnpm --filter @create-font/editor exec lasertag check --format=json --max-files=all "src/**/*.module.css"
```

The full 0.6.6 check returned 261 diagnostics at 89 distinct
file/line/code locations across nine CSS Modules.

The difference matters. Broad selectors in `TilingWorkspace` and
`VersionControlTile` can cross several known icon roots, so Lasertag emits
separate evidence for each foreign component. Those two files account for 238
of the 261 diagnostics while representing 66 distinct selector locations.

| File                             | Reported diagnostics | Distinct locations | Active category          |
| -------------------------------- | -------------------: | -----------------: | ------------------------ |
| `ActionHotbar.module.css`        |                    5 |                  5 | Transparent contract     |
| `AppShell.module.css`            |                    9 |                  9 | Transparent contract     |
| `FontInfo.module.css`            |                    1 |                  1 | NumericInput ownership   |
| `GlyphInspector.module.css`      |                    2 |                  2 | NumericInput ownership   |
| `GlyphLibrary.module.css`        |                    1 |                  1 | Transparent contract     |
| `KerningTile.module.css`         |                    2 |                  2 | NumericInput ownership   |
| `SelectionDimensions.module.css` |                    3 |                  3 | NumericInput ownership   |
| `TilingWorkspace.module.css`     |                  126 |                 18 | Shell-path precision     |
| `VersionControlTile.module.css`  |                  112 |                 48 | Component-path precision |
| **Total**                        |              **261** |             **89** |                          |

By diagnostic code, the full run reports:

- 254 `selector-crosses-ownership-boundary`;
- 5 `selector-matches-foreign-component-root`;
- 2 `opaque-component-root-may-collide`.

At distinct locations, those counts are 82, 5, and 2 respectively.

### Batch-analysis discrepancy, resolved in 0.6.7

`KerningTile.module.css` is the only inconsistent result observed during the
inventory. In the full glob it reports two grouped
`opaque-component-root-may-collide` diagnostics for `NumericInput`. Checked
alone or in a small explicit file set, the same selectors become one verified
root match and one crossing beneath `<numeric-input>`.

The parent no longer owns `NumericInput`'s input chrome. In 0.6.6, one narrow
expectation remained immediately above `kerning-tile > label > span`, because
the result depended on the previous root analyzed in the same worker's reused
TypeScript session. The issue was reported as
[Lasertag #165](https://github.com/jeremybanka/lasertag/issues/165).

Lasertag 0.6.7 fixes that session transition. The full batch, isolated analysis,
the editor extension, and CI now resolve the adjacent `NumericInput` root
consistently, so the temporary expectation has been removed.

## Implementation result

Implemented on 2026-07-22. The full repository check now reports:

```text
✓ No dead CSS found in 20 files.
```

Reverified after upgrading to Lasertag 0.6.7: the result remains clean without
the Kerning batch-analysis expectation.

The changes follow the plan without introducing inline presentation or
analysis-only wrappers:

- `TilingWorkspace.module.css` now anchors ordinary, empty, management, and
  reduced-motion rules to the exact lane/track/column/scroll/stack shell. This
  eliminated all 126 amplified diagnostics from its 18 selector locations.
- `VersionControlTile.module.css` now addresses only its direct owned branches,
  including explicit control, list, empty-state, and dialog paths. This
  eliminated all 112 diagnostics from its 48 selector locations.
- `NumericInput` now owns its input chrome. Its default is the compact
  inspector/kerning presentation, `appearance="strong"` preserves the
  selection-dimension fields, and `appearance="roomy"` preserves font-info
  fields. Parent stylesheets no longer cross into the internal input.
- `AppAnchor` now owns `display: contents` in its own CSS Module. `AppShell`,
  `ActionHotbar`, and `GlyphLibrary` retain only narrow explained directives
  where the caller intentionally styles a transparent routing or tooltip
  contract.
- The existing local `svg.*` namespaces remain the stable SVG-root assertions;
  the path rewrites made the obsolete tiling and version-control icon
  expectations removable.

### Verification evidence

- Editor tests: 48 files and 392 tests passed.
- ESLint, dprint, `git diff --check`, and the full Lasertag check passed.
- The repository-wide VP check completed with zero errors and four unrelated
  warnings in `packages/create-font/states/src/state.ts` and
  `packages/create-font/editor/tests/pen-gesture.test.ts`.
- An agentic Playwright pass exercised the normal tiling workspace and tile
  management at 1440×1000 and 390×844. Both viewports retained exact document
  width with no horizontal overflow; the narrow management sheet and its exit,
  destination, search, and save controls remained reachable.
- Playwright exercised the version-control empty state and measured all of its
  controls inside the tile bounds. It also confirmed that every `AppAnchor`
  computes to `display: contents` and reported no browser console errors.
- Playwright rendered and measured all three `NumericInput` appearances:
  compact inspector/kerning fields remained 6px padded, 5px radius, 10px/10px,
  weight 570, tabular numerals; strong selection fields retained the stronger
  border, weight 550, and normal numerals; roomy font-info fields remained
  9px 10px padded, 6px radius, 11px/13.2px, weight 500.

## Revised categories

### 1. Transparent behavior contracts — 15 locations

Files:

- `ActionHotbar.module.css`: five selectors entering the button exposed by
  `TooltipButton`;
- `GlyphLibrary.module.css`: one selector entering the same primitive;
- `AppShell.module.css`: three verified `AppAnchor` root matches and six
  selectors entering its anchor.

These remain intentional exceptions. `TooltipButton` supplies behavior and
accessibility while its caller owns the context-specific button presentation.
`AppAnchor` is a routing adapter whose public shape is `app-anchor > a`.

The new diagnostic split lets the exceptions be more exact:

- explain `selector-matches-foreign-component-root` only where the caller
  intentionally owns placement or presentation of the foreign root;
- explain `selector-crosses-ownership-boundary` only for the stable transparent
  internals;
- keep the regions adjacent to the relevant component block rather than using a
  file-wide disable.

Do not introduce visual variants into these primitives merely to silence the
checker. Their existing transparent contracts are coherent and reused.

### 2. `NumericInput` ownership — 8 locations

Files:

- `FontInfo.module.css`: one internal-input crossing;
- `GlyphInspector.module.css`: one redundant root style and one input crossing;
- `KerningTile.module.css`: one redundant root style and one input crossing
  when analyzed independently;
- `SelectionDimensions.module.css`: one root style and two input crossings.

`NumericInput.module.css` already sets `display: contents`. The duplicate
parent declarations in `GlyphInspector` and `KerningTile` should be deleted.
The root width/min-width rule in `SelectionDimensions` has no useful effect on
a `display: contents` element and should also be removed.

The five remaining input-chrome crossings are genuine ownership leaks. Move the
shared field chrome into `NumericInput.module.css`:

- box sizing, width, and minimum width;
- background and text color;
- border and radius;
- the compact padding/font treatment shared by `GlyphInspector` and
  `KerningTile`.

Before adding variants, compare the three remaining presentations:

- compact inspector/kerning;
- compact selection fields with a stronger border;
- roomy font-info fields.

Prefer one default appearance plus the smallest named appearance distinction
that preserves intentional visual differences. Do not expose independent props
for every CSS value or move presentation into inline styles. Browser validation
should compare all four call sites at desktop and narrow widths.

### 3. Tiling shell-path precision — 18 locations

The 18 distinct selectors in `TilingWorkspace.module.css` expand to 126
diagnostics because broad descendant paths can enter several asserted SVG roots.
The high diagnostic count is evidence amplification, not 126 separate fixes.

Anchor tile and column rules to the exact owned shell:

```text
tiling-workspace
└─ tile-lane
   └─ tile-track
      └─ tile-column
         └─ column-scroll
            └─ tile-stack
               └─ workspace-tile
```

Apply that structure consistently to:

- ordinary tile-shell styles;
- `empty-column`;
- management-mode rules;
- reduced-motion rules.

Do not suppress these warnings. The stylesheet owns the tiling shell but not the
components rendered inside `tile-content`. After the path rewrite, remove the
two icon-root expectation comments if Lasertag marks them unused.

### 4. `VersionControlTile` path precision — 48 locations

The 48 broad selector locations expand to 112 diagnostics because
`svg.Check` and `svg.Cross` make their foreign boundaries explicit.

Treat all 48 as path-precision work, including the six component-wide
`button`/`input`/`textarea` baseline selectors that were previously classed
as exceptions. In 0.6.6 those selectors are demonstrably capable of entering
foreign icon internals; keeping them broad would depend on undocumented details
below the asserted SVG root.

Rewrite around direct owned branches:

- `> comparison-controls`;
- `> comparison-status`;
- `> diff-view-toggle`;
- `> change-counts`;
- `> empty-changes`;
- the exact outer-list/button/marker path;
- `> dialog > form` and its direct heading, selection, and footer groups.

Scope shared control typography and focus treatment to those owned branches
instead of retaining a component-wide descendant baseline. This is mostly a
combinator rewrite; it should not require splitting the component or moving CSS
to another file.

Afterward, remove the `empty-changes > svg` expectation if it becomes unused.

## Existing directives to audit

The 0.6.2 work added five expectation sites and one scoped region covering seven
icon-root diagnostics. Under the revised plan:

- keep the `EditorIcon.module.css` expectation for its dynamic Radix map;
- keep or narrow the `CommandPalette.module.css` expectation for styling the
  verified `EditorIcon` custom root;
- consolidate the `ActionHotbar` icon region with the surrounding
  `TooltipButton` transparent-contract explanation;
- expect the two `TilingWorkspace` comments and the
  `VersionControlTile` comment to become unused after path cleanup, then remove
  them.

Lasertag 0.6.6 reports unused directives, so the final check is the authority;
do not retain comments preemptively.

## Execution order

1. **Tiling shell paths.** Remove the largest diagnostic amplification while
   preserving all opaque tile-body boundaries.
2. **Version-control paths.** Make the component's owned structure explicit and
   eliminate broad baselines.
3. **NumericInput ownership.** Remove redundant root rules, consolidate input
   chrome, then add only the minimum appearance distinction supported by visual
   evidence.
4. **Transparent contracts.** Add or consolidate diagnostic-specific explained
   regions for `TooltipButton` and `AppAnchor`.
5. **Directive cleanup.** Remove every expectation or enable/disable region that
   0.6.6 reports as unused.
6. **Verification.** Run formatting, ESLint, the editor tests, the full Lasertag
   glob, individual checks for each changed CSS Module, and Playwright visual
   validation for the tiling workspace, version-control tile, and all
   `NumericInput` appearances.

## Completion target

The target is a clean full Lasertag check:

- no hygiene diagnostics;
- no opaque collision diagnostics left uninvestigated;
- only narrow, explained directives for genuine transparent or stable-root
  contracts;
- no unused directives;
- no presentation moved into inline JSX attributes;
- no analysis-only DOM wrappers.

The historical 0.6.0 classification was 21 exceptions, 66 hygiene findings, and
34 icon-root feature-request items. The 34 icon items remain resolved by the
0.6.2 namespace work. The active 0.6.6 plan supersedes the old count-based
buckets because implementation evidence now distinguishes root matches,
internal crossings, and opaque collision risks directly.
