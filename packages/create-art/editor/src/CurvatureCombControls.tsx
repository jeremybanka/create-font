import type { CurvatureSide } from "@create-art/vector-geometry"

import { TileCheckbox } from "./TileCheckbox.tsx"
import { TileNumericField } from "./TileNumericField.tsx"
import { TileSelect } from "./TileSelect.tsx"
import css from "./CurvatureCombControls.module.css"

export interface CurvatureCombControlsProps {
	readonly enabled: boolean
	readonly disabledReason?: string | null
	readonly size: number
	readonly intensity: number
	readonly side: CurvatureSide
	readonly onEnabledChange: (enabled: boolean) => void
	readonly onSizeChange: (size: number) => void
	readonly onIntensityChange: (intensity: number) => void
	readonly onSideChange: (side: CurvatureSide) => void
}

/** Compact, shared control surface for product-local curvature-comb state. */
export function CurvatureCombControls({
	enabled,
	disabledReason = null,
	size,
	intensity,
	side,
	onEnabledChange,
	onSizeChange,
	onIntensityChange,
	onSideChange,
}: CurvatureCombControlsProps) {
	const unavailable = disabledReason !== null
	const settingsDisabled = unavailable || !enabled
	return (
		<curvature-comb-controls className={css.class}>
			<TileCheckbox
				label="Show curvature comb"
				checked={enabled}
				disabled={unavailable}
				description={
					disabledReason ??
					(enabled
						? "Selected cubic contours are visualized on the canvas."
						: "Enable the diagnostic to adjust its appearance.")
				}
				onChange={(event) => onEnabledChange(event.currentTarget.checked)}
			/>
			<curvature-comb-fields>
				<TileNumericField
					label="Size"
					value={size}
					min={0.1}
					max={3}
					step={0.1}
					arrowStep={0.1}
					disabled={settingsDisabled}
					description="0.1–3×"
					onCommit={onSizeChange}
				/>
				<TileNumericField
					label="Intensity"
					value={Math.round(intensity * 100)}
					min={10}
					max={100}
					step={5}
					arrowStep={5}
					disabled={settingsDisabled}
					description="10–100%"
					onCommit={(percent) => onIntensityChange(percent / 100)}
				/>
			</curvature-comb-fields>
			<TileSelect
				label="Direction"
				value={side}
				disabled={settingsDisabled}
				description="Outer keeps every tooth outside; Signed reveals curvature direction."
				onChange={(event) =>
					onSideChange(event.currentTarget.value as CurvatureSide)
				}
			>
				<option value="outside">Outer</option>
				<option value="signed">Signed</option>
			</TileSelect>
		</curvature-comb-controls>
	)
}
