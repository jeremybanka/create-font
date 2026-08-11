import { createUiLayoutClient } from "@create-art/ui-layout/client"
import {
	canonicalUiLayout,
	type UiLayoutOrigin,
	type UiLayoutProduct,
	type UiLayoutRecordV1,
	type UiLayoutSource,
	uiLayoutRecordV1Schema,
} from "@create-art/ui-layout"
import { useEffect, useMemo, useState } from "react"
import css from "./UiLayoutControl.module.css"

export type UiLayoutOption = Readonly<{
	origin: UiLayoutOrigin
	record: UiLayoutRecordV1
	revision: string | null
}>
export type UiLayoutControlProps<Record extends UiLayoutRecordV1> = Readonly<{
	product: UiLayoutProduct
	current: Record
	onApply: (record: Record) => void
}>

const client = createUiLayoutClient()
const workingKey = (product: UiLayoutProduct) =>
	`${product}:ui-layout:working:v1`
const selectionKey = (product: UiLayoutProduct) =>
	`${product}:ui-layout:selection:v1`
const optionKey = ({ origin, record }: UiLayoutOption) =>
	`${origin}:${record.id}`

export function UiLayoutControl<Record extends UiLayoutRecordV1>({
	product,
	current,
	onApply,
}: UiLayoutControlProps<Record>) {
	const [sources, setSources] = useState<readonly UiLayoutSource[]>([])
	const [selected, setSelected] = useState(() => {
		try {
			return localStorage.getItem(selectionKey(product)) ?? ""
		} catch {
			return ""
		}
	})
	const [origin, setOrigin] = useState<UiLayoutOrigin>("home")
	const [name, setName] = useState(current.name)
	const [error, setError] = useState("")
	const [saving, setSaving] = useState(false)
	const [workingReady, setWorkingReady] = useState(false)
	const options = useMemo<readonly UiLayoutOption[]>(
		() =>
			sources.flatMap((source) =>
				source.layouts
					.filter((record) => record.product === product)
					.map((record) => ({
						origin: source.origin,
						revision: source.revision,
						record,
					})),
			),
		[product, sources],
	)
	const selectedOption = options.find(
		(option) => optionKey(option) === selected,
	)
	const baseline = selectedOption?.record
	const dirty =
		baseline === undefined ||
		JSON.stringify(current.state) !== JSON.stringify(baseline.state)

	useEffect(() => {
		try {
			const raw = localStorage.getItem(workingKey(product))
			if (raw !== null) {
				const parsed = uiLayoutRecordV1Schema.safeParse(JSON.parse(raw))
				if (parsed.success && parsed.data.product === product)
					onApply(parsed.data as Record)
			}
		} catch {
			/* Existing split browser state remains the migration source. */
		} finally {
			setWorkingReady(true)
		}
	}, [onApply, product])

	useEffect(() => {
		void client
			.load(product)
			.then(({ sources: loaded }) => {
				setSources(loaded)
				const diagnostics = loaded.flatMap(({ issues }) => issues)
				if (diagnostics.length > 0)
					setError(
						diagnostics
							.map((issue) => `${issue.file} ${issue.path}: ${issue.message}`)
							.join("; "),
					)
			})
			.catch((reason: unknown) =>
				setError(
					reason instanceof Error
						? reason.message
						: "Could not load UI layouts.",
				),
			)
	}, [onApply, product])

	useEffect(() => {
		if (selectedOption === undefined) return
		setName(selectedOption.record.name)
		setOrigin(selectedOption.origin)
	}, [selectedOption])

	useEffect(() => {
		if (!workingReady) return
		try {
			localStorage.setItem(
				workingKey(product),
				canonicalUiLayout({
					...current,
					id: selectedOption?.record.id ?? current.id,
					name,
				}),
			)
		} catch {
			/* best effort */
		}
	}, [current, name, product, selectedOption, workingReady])

	const choose = (value: string): void => {
		setSelected(value)
		try {
			localStorage.setItem(selectionKey(product), value)
		} catch {
			/* best effort */
		}
		const option = options.find((candidate) => optionKey(candidate) === value)
		if (option === undefined) return
		setOrigin(option.origin)
		setName(option.record.name)
		onApply(option.record as Record)
		setError("")
	}
	const save = async (): Promise<void> => {
		const trimmed = name.trim()
		if (!trimmed) {
			setError("Name this layout before saving.")
			return
		}
		setSaving(true)
		setError("")
		const matching =
			selectedOption?.origin === origin ? selectedOption : undefined
		const layout = {
			...current,
			id: matching?.record.id ?? current.id,
			name: trimmed,
		} as Record
		try {
			const destination = sources.find((source) => source.origin === origin)
			const response = await client.save({
				product,
				origin,
				expectedRevision: destination?.revision ?? null,
				layout,
			})
			setSources(response.sources)
			const next = `${origin}:${layout.id}`
			setSelected(next)
			try {
				localStorage.setItem(selectionKey(product), next)
				localStorage.setItem(workingKey(product), canonicalUiLayout(layout))
			} catch {
				/* best effort */
			}
			onApply(layout)
		} catch (reason) {
			setError(
				reason instanceof Error ? reason.message : "Could not save UI layout.",
			)
		} finally {
			setSaving(false)
		}
	}

	return (
		<ui-layout-control className={css.class} aria-label="UI layout">
			<label data-screen-reader htmlFor={`${product}-ui-layout`}>
				Saved UI layout
			</label>
			<select
				id={`${product}-ui-layout`}
				aria-label="Saved UI layout"
				value={selected}
				onChange={(event) => choose(event.currentTarget.value)}
			>
				<option value="">Current local layout</option>
				{options.map((option) => (
					<option key={optionKey(option)} value={optionKey(option)}>
						{option.record.name} —{" "}
						{option.origin === "home" ? "Home" : "Project"}
					</option>
				))}
			</select>
			<input
				aria-label="Layout name"
				value={name}
				onChange={(event) => setName(event.currentTarget.value)}
			/>
			<select
				aria-label="Save layout to"
				value={origin}
				onChange={(event) =>
					setOrigin(event.currentTarget.value as UiLayoutOrigin)
				}
			>
				<option value="home">Home</option>
				<option value="project">Project</option>
			</select>
			<button type="button" disabled={saving} onClick={() => void save()}>
				{saving ? "Saving…" : "Save"}
			</button>
			{dirty ? (
				<status-dot role="status" aria-label="UI layout has unsaved changes">
					Unsaved
				</status-dot>
			) : null}
			{error ? (
				<output role="alert" title={error}>
					{error}
				</output>
			) : null}
		</ui-layout-control>
	)
}
