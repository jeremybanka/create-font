import { useO } from "atom.io/react"

import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./KerningTile.module.css"
import { NumericInput } from "@create-art/editor"

export function KerningTile({
	workspace,
}: {
	readonly workspace: EditorWorkspace
}) {
	const pair = useO(workspace.ui.activeKerningPair)
	const setKerningAndRestoreCanvas = (value: number | null): void => {
		workspace.actions.setActiveKerning(value)
		workspace.actions.restoreTextCanvasFocus()
	}
	return (
		<kerning-tile
			className={css.class}
			data-state={pair?.value == null ? "absent" : "explicit"}
		>
			<kerning-heading>
				<span>Pair inspector</span>
				<status-dot
					aria-hidden="true"
					data-state={pair?.value == null ? "absent" : "explicit"}
				/>
			</kerning-heading>
			{pair === null ? (
				<kerning-section>
					<h2>Pair</h2>
					<p>Place the text cursor between two glyphs to edit their kerning.</p>
				</kerning-section>
			) : (
				<>
					<kerning-section>
						<h2>Pair</h2>
						<dl>
							<dt>Left</dt>
							<dd>{pair.left.slice(6)}</dd>
							<dt>Right</dt>
							<dd>{pair.right.slice(6)}</dd>
							<dt>Status</dt>
							<dd role="status">
								Kerning: {pair.value === null ? "Absent" : "Explicit"}
							</dd>
						</dl>
					</kerning-section>

					<kerning-section data-accent={pair.value === null ? "false" : "true"}>
						<h2>Adjustment</h2>
						<kerning-field>
							<label>
								<span>Amount</span>
								<NumericInput
									aria-label="Kerning amount"
									value={pair.value ?? 0}
									min={-32768}
									max={32767}
									step={1}
									arrowStep={1}
									onCommit={setKerningAndRestoreCanvas}
								/>
							</label>
							<button
								type="button"
								disabled={pair.value === null}
								onClick={() => setKerningAndRestoreCanvas(null)}
							>
								Remove kerning
							</button>
						</kerning-field>
					</kerning-section>

					<kerning-section>
						<h2>Keyboard</h2>
						<p>
							⌥ + ←/→ nudges by 1; add Shift for 10 or Command/Control for 100.
						</p>
					</kerning-section>
				</>
			)}
		</kerning-tile>
	)
}
