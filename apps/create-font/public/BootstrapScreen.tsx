import type { BootstrapState } from "./bootstrap-state.ts"

export interface BootstrapScreenProps {
	readonly onAction: () => void
	readonly state: BootstrapState
}

export function BootstrapScreen({ onAction, state }: BootstrapScreenProps) {
	const loading = state.type === `loading`
	return (
		<bootstrap-screen data-state={state.type}>
			<bootstrap-card>
				<bootstrap-brand aria-hidden="true">
					<brand-symbol>
						<i />
						<i />
						<i />
					</brand-symbol>
					<strong>create-font</strong>
				</bootstrap-brand>
				<bootstrap-copy
					role={loading ? `status` : `alert`}
					aria-live={loading ? `polite` : `assertive`}
					aria-atomic="true"
				>
					<p>
						{loading
							? `Opening your font workspace`
							: `Font source unavailable`}
					</p>
					<h1>
						{loading
							? `Preparing the drawing room…`
							: `We could not open this project.`}
					</h1>
					<span>
						{loading
							? `Connecting to the source session and hydrating editable outlines.`
							: state.message}
					</span>
				</bootstrap-copy>
				{loading ? (
					<loading-meter aria-hidden="true">
						<i />
						<i />
						<i />
					</loading-meter>
				) : (
					<bootstrap-actions>
						<button type="button" onClick={onAction}>
							Try again
						</button>
						<small>
							If the problem continues, check the create-font process in your
							terminal.
						</small>
					</bootstrap-actions>
				)}
			</bootstrap-card>
			<bootstrap-detail aria-hidden="true">
				<span>Source</span>
				<span>Outline</span>
				<span>Compile</span>
			</bootstrap-detail>
		</bootstrap-screen>
	)
}
