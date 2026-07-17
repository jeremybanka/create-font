import {
	MAX_OVERSHOOT_DEPTH,
	VERTICAL_ALIGNMENT_METRIC_IDS,
	type EditorFontSource,
	type VerticalAlignmentMetricId,
} from "@create-font/states"

import type { EditorWorkspace } from "./editor-workspace.ts"
import css from "./FontInfo.module.css"
import { useO } from "./state-hooks.ts"

export interface FontInfoProps {
	readonly workspace: EditorWorkspace
}

type Names = EditorFontSource["names"]
type Metadata = EditorFontSource["metadata"]
type Metrics = EditorFontSource["metrics"]
type Style = EditorFontSource["style"]

export function FontInfo({ workspace }: FontInfoProps) {
	const source =
		useO(workspace.font.selectors.editorSource) ?? workspace.document
	const names = useO(workspace.font.atoms.names) ?? source.names
	const metadata = useO(workspace.font.atoms.metadata) ?? source.metadata
	const metrics = useO(workspace.font.atoms.metrics) ?? source.metrics
	const style = useO(workspace.font.atoms.style) ?? source.style
	const setNames = <Key extends keyof Names>(key: Key, value: Names[Key]) => {
		workspace.font.silo.setState(
			workspace.font.atoms.names,
			Object.freeze({ ...names, [key]: value }),
		)
	}
	const setMetadata = <Key extends keyof Metadata>(
		key: Key,
		value: Metadata[Key],
	) => {
		workspace.font.silo.setState(
			workspace.font.atoms.metadata,
			Object.freeze({ ...metadata, [key]: value }),
		)
	}
	const setMetrics = <Key extends keyof Metrics>(
		key: Key,
		value: Metrics[Key],
	) => {
		workspace.font.silo.setState(
			workspace.font.atoms.metrics,
			Object.freeze({ ...metrics, [key]: value }),
		)
	}
	const setStyle = <Key extends keyof Style>(key: Key, value: Style[Key]) => {
		workspace.font.silo.setState(
			workspace.font.atoms.style,
			Object.freeze({ ...style, [key]: value }),
		)
	}
	const setOvershoot = (
		key: VerticalAlignmentMetricId,
		value: number,
	): void => {
		workspace.font.silo.setState(
			workspace.font.atoms.metrics,
			Object.freeze({
				...metrics,
				overshoots: Object.freeze({ ...metrics.overshoots, [key]: value }),
			}),
		)
	}

	return (
		<font-info className={css.class}>
			<info-heading>
				<p>Font source</p>
				<h1>Font Info</h1>
				<span>
					Global naming, technical characteristics, metrics, and design space.
				</span>
			</info-heading>

			<info-layout>
				<info-section>
					<section-heading>
						<heading-copy>
							<h2>Naming</h2>
							<p>Names exposed to applications and operating systems.</p>
						</heading-copy>
					</section-heading>
					<field-grid>
						<TextField
							label="Family"
							value={names.family}
							onInput={(value) => setNames("family", value)}
						/>
						<TextField
							label="Subfamily"
							value={names.subfamily}
							onInput={(value) => setNames("subfamily", value)}
						/>
						<TextField
							label="Typographic family"
							value={names.typographicFamily}
							onInput={(value) => setNames("typographicFamily", value)}
						/>
						<TextField
							label="Typographic subfamily"
							value={names.typographicSubfamily}
							onInput={(value) => setNames("typographicSubfamily", value)}
						/>
						<TextField
							label="Full name"
							value={names.fullName}
							onInput={(value) => setNames("fullName", value)}
						/>
						<TextField
							label="PostScript name"
							value={names.postScriptName}
							onInput={(value) => setNames("postScriptName", value)}
						/>
						<TextField
							label="Unique ID"
							value={names.uniqueId}
							onInput={(value) => setNames("uniqueId", value)}
						/>
						<TextField
							label="Version string"
							value={names.version}
							onInput={(value) => setNames("version", value)}
						/>
					</field-grid>
				</info-section>

				<info-section>
					<section-heading>
						<heading-copy>
							<h2>Characteristics</h2>
							<p>Global font identity and OpenType classification.</p>
						</heading-copy>
					</section-heading>
					<field-grid>
						<NumberField
							label="Units per em"
							value={metadata.unitsPerEm}
							onInput={(value) => setMetadata("unitsPerEm", value)}
						/>
						<NumberField
							label="Font revision"
							step="0.001"
							value={metadata.fontRevision}
							onInput={(value) => setMetadata("fontRevision", value)}
						/>
						<TextField
							label="Vendor ID"
							value={metadata.vendorId}
							onInput={(value) => setMetadata("vendorId", value)}
						/>
						<NumberField
							label="Lowest PPEM"
							value={metadata.lowestPpem}
							onInput={(value) => setMetadata("lowestPpem", value)}
						/>
						<NumberField
							label="Weight class"
							value={style.weightClass}
							onInput={(value) => setStyle("weightClass", value)}
						/>
						<NumberField
							label="Width class"
							value={style.widthClass}
							onInput={(value) => setStyle("widthClass", value)}
						/>
						<NumberField
							label="Italic angle"
							step="0.1"
							value={style.italicAngle}
							onInput={(value) => setStyle("italicAngle", value)}
						/>
						<flag-group>
							<span>Style flags</span>
							<label>
								<input
									type="checkbox"
									checked={style.bold}
									onInput={(event) =>
										setStyle("bold", event.currentTarget.checked)
									}
								/>
								Bold
							</label>
							<label>
								<input
									type="checkbox"
									checked={style.italic}
									onInput={(event) =>
										setStyle("italic", event.currentTarget.checked)
									}
								/>
								Italic
							</label>
							<label>
								<input
									type="checkbox"
									checked={style.oblique}
									onInput={(event) =>
										setStyle("oblique", event.currentTarget.checked)
									}
								/>
								Oblique
							</label>
						</flag-group>
					</field-grid>
				</info-section>

				<info-section>
					<section-heading>
						<heading-copy>
							<h2>Vertical metrics</h2>
							<p>Shared layout and platform metric values.</p>
						</heading-copy>
					</section-heading>
					<field-grid>
						{(
							[
								["Ascender", "ascender"],
								["Descender", "descender"],
								["Line gap", "lineGap"],
								["Windows ascent", "winAscent"],
								["Windows descent", "winDescent"],
								["x-height", "xHeight"],
								["Cap height", "capHeight"],
								["Underline position", "underlinePosition"],
								["Underline thickness", "underlineThickness"],
							] as const
						).map(([label, key]) => (
							<NumberField
								key={key}
								label={label}
								value={metrics[key]}
								onInput={(value) => setMetrics(key, value)}
							/>
						))}
					</field-grid>
					<section-heading>
						<heading-copy>
							<h3>Alignment overshoots</h3>
							<p>Permitted rounded-outline depth beyond each alignment line.</p>
						</heading-copy>
					</section-heading>
					<field-grid>
						{VERTICAL_ALIGNMENT_METRIC_IDS.map((key) => (
							<NumberField
								key={`overshoot:${key}`}
								label={`${overshootLabel(key)} overshoot`}
								value={metrics.overshoots[key]}
								min={0}
								max={MAX_OVERSHOOT_DEPTH}
								onInput={(value) => setOvershoot(key, value)}
							/>
						))}
					</field-grid>
				</info-section>

				<info-section data-wide="true">
					<section-heading>
						<heading-copy>
							<h2>Design space</h2>
							<p>Axes, source masters, and named instances in this font.</p>
						</heading-copy>
					</section-heading>
					<design-space-grid>
						<entity-list>
							<h3>Axes</h3>
							{source.axes.map((axis) => (
								<article key={axis.id}>
									<strong>{axis.name}</strong>
									<code>{axis.tag}</code>
									<span>
										{axis.min} / {axis.default} / {axis.max}
									</span>
								</article>
							))}
						</entity-list>
						<entity-list>
							<h3>Masters</h3>
							{source.masters.map((master) => (
								<article key={master.id}>
									<strong>{master.name}</strong>
									<code>{master.kind}</code>
									<span>
										{master.kind === "default"
											? "Default source"
											: source.axes
													.map(
														(axis) =>
															`${axis.tag} ${master.location[axis.id] ?? axis.default}`,
													)
													.join(" · ")}
									</span>
								</article>
							))}
						</entity-list>
						<entity-list>
							<h3>Instances</h3>
							{source.instances.map((instance) => (
								<article key={instance.id}>
									<strong>{instance.name}</strong>
									<code>{instance.elidable ? "elidable" : "named"}</code>
									<span>
										{source.axes
											.map(
												(axis) =>
													`${axis.tag} ${instance.coordinates[axis.id] ?? axis.default}`,
											)
											.join(" · ")}
									</span>
								</article>
							))}
						</entity-list>
					</design-space-grid>
				</info-section>
			</info-layout>
		</font-info>
	)
}

function TextField({
	label,
	onInput,
	value,
}: {
	readonly label: string
	readonly onInput: (value: string) => void
	readonly value: string
}) {
	return (
		<text-field>
			<label>
				<span>{label}</span>
				<input
					type="text"
					value={value}
					onInput={(event) => onInput(event.currentTarget.value)}
				/>
			</label>
		</text-field>
	)
}

function NumberField({
	label,
	max,
	min,
	onInput,
	step = "1",
	value,
}: {
	readonly label: string
	readonly max?: number
	readonly min?: number
	readonly onInput: (value: number) => void
	readonly step?: string
	readonly value: number
}) {
	return (
		<number-field>
			<label>
				<span>{label}</span>
				<input
					type="number"
					min={min}
					max={max}
					step={step}
					value={value}
					onInput={(event) => {
						const next = event.currentTarget.valueAsNumber
						if (Number.isFinite(next)) onInput(next)
					}}
				/>
			</label>
		</number-field>
	)
}

function overshootLabel(key: VerticalAlignmentMetricId): string {
	return (
		{
			baseline: "Baseline",
			ascender: "Ascender",
			descender: "Descender",
			winAscent: "Windows ascent",
			winDescent: "Windows descent",
			xHeight: "x-height",
			capHeight: "Cap height",
			underlinePosition: "Underline position",
		} as const
	)[key]
}
