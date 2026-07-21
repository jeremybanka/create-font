import type { EditorWorkspace } from "./editor-workspace.ts"
import { NumericInput } from "./NumericInput.tsx"
import { useO } from "./state-hooks.ts"

export function KerningTile({
	workspace,
}: {
	readonly workspace: EditorWorkspace
}) {
	const pair = useO(workspace.ui.activeKerningPair)
	return (
		<kerning-tile>
			{pair === null ? (
				<p>Place the text cursor between two glyphs to edit their kerning.</p>
			) : (
				<>
					<p>
						<strong>
							{pair.left.slice(6)} / {pair.right.slice(6)}
						</strong>
					</p>
					<NumericInput
						aria-label="Kerning amount"
						value={pair.value ?? 0}
						min={-32768}
						max={32767}
						step={1}
						arrowStep={1}
						onCommit={(value) => workspace.actions.setActiveKerning(value)}
					/>
					<button
						type="button"
						disabled={pair.value === null}
						onClick={() => workspace.actions.setActiveKerning(null)}
					>
						Remove kerning
					</button>
					<p>
						⌥ + ←/→ nudges by 1; add Shift for 10 or Command/Control for 100.
					</p>
				</>
			)}
		</kerning-tile>
	)
}
