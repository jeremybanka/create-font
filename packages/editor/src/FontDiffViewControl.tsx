import css from "./FontDiffViewControl.module.css"

export interface FontDiffViewControlProps {
	readonly diffView: boolean
	readonly disabled: boolean
	readonly onDiffViewChange: (enabled: boolean) => void
}

/** Font-owned visual comparison control used by the shared review surface. */
export function FontDiffViewControl({
	diffView,
	disabled,
	onDiffViewChange,
}: FontDiffViewControlProps) {
	return (
		<font-diff-view-control className={css.class}>
			<toggle-copy>
				<strong>Diff View</strong>
				<small>
					Compare the active glyph without changing the live source.
				</small>
			</toggle-copy>
			<button
				type="button"
				aria-pressed={diffView}
				disabled={disabled}
				onClick={() => onDiffViewChange(!diffView)}
			>
				{diffView ? "On" : "Off"}
			</button>
		</font-diff-view-control>
	)
}
