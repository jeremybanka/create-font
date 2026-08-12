import { BookmarkFilledIcon } from "@radix-ui/react-icons"
import { createUiLayoutClient } from "@create-art/ui-layout/client"
import {
	canonicalUiLayout,
	type UiLayoutOrigin,
	type UiLayoutProduct,
	type UiLayoutRecordV1,
	type UiLayoutSource,
	uiLayoutRecordV1Schema,
} from "@create-art/ui-layout"
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react"
import css from "./UiLayoutControl.module.css"

export type UiLayoutOption = Readonly<{
	origin: UiLayoutOrigin
	record: UiLayoutRecordV1
	revision: string | null
}>
export type UiLayoutControlProps = Readonly<{
	product: UiLayoutProduct
	current: UiLayoutRecordV1
	onApply: (record: UiLayoutRecordV1) => void
}>
export interface UiLayoutControlHandle {
	save: () => Promise<void>
}

const client = createUiLayoutClient()
const workingKey = (product: UiLayoutProduct) =>
	`${product}:ui-layout:working:v1`
const selectionKey = (product: UiLayoutProduct) =>
	`${product}:ui-layout:selection:v1`
const optionKey = ({ origin, record }: UiLayoutOption) =>
	`${origin}:${record.id}`
const ORIGINS = ["project", "home"] as const satisfies readonly UiLayoutOrigin[]

export const UiLayoutControl = forwardRef<
	UiLayoutControlHandle,
	UiLayoutControlProps
>(function UiLayoutControl({ product, current, onApply }, ref) {
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
	const restoredWorking = useRef(false)
	const options = useMemo<readonly UiLayoutOption[]>(
		() =>
			ORIGINS.flatMap((groupOrigin) => {
				const source = sources.find(
					({ origin: candidate }) => candidate === groupOrigin,
				)
				return (
					source?.layouts
						.filter((record) => record.product === product)
						.map((record) => ({
							origin: groupOrigin,
							revision: source.revision,
							record,
						})) ?? []
				)
			}),
		[product, sources],
	)
	const selectedOption = options.find(
		(option) => optionKey(option) === selected,
	)
	const baseline = selectedOption?.record
	const dirty =
		baseline === undefined ||
		name.trim() !== baseline.name ||
		JSON.stringify(current.state) !== JSON.stringify(baseline.state)
	const layoutState =
		baseline === undefined ? "local" : dirty ? "modified" : "saved"
	const layoutStatus =
		layoutState === "local"
			? "Local only"
			: layoutState === "modified"
				? "Modified"
				: "Saved"

	useEffect(() => {
		try {
			const raw = localStorage.getItem(workingKey(product))
			if (raw !== null) {
				const parsed = uiLayoutRecordV1Schema.safeParse(JSON.parse(raw))
				if (parsed.success && parsed.data.product === product) {
					restoredWorking.current = true
					setName(parsed.data.name)
					onApply(parsed.data)
				}
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
	}, [product])

	useEffect(() => {
		if (selectedOption === undefined) return
		if (!restoredWorking.current) setName(selectedOption.record.name)
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
		if (option === undefined) {
			setName(current.name)
			return
		}
		setOrigin(option.origin)
		setName(option.record.name)
		onApply(option.record)
		setError("")
	}
	const save = useCallback(async (): Promise<void> => {
		const trimmed = name.trim()
		if (!trimmed) {
			setError("Name this layout before saving.")
			return
		}
		if (saving) return
		setSaving(true)
		setError("")
		const matching =
			selectedOption?.origin === origin ? selectedOption : undefined
		const layout = {
			...current,
			id: matching?.record.id ?? current.id,
			name: trimmed,
		}
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
	}, [current, name, onApply, origin, product, saving, selectedOption, sources])

	useImperativeHandle(ref, () => ({ save }), [save])

	return (
		<ui-layout-control className={css.class} aria-label="UI layout">
			<layout-picker>
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
					{ORIGINS.map((groupOrigin) => (
						<optgroup
							key={groupOrigin}
							label={groupOrigin === "project" ? "Project" : "Home"}
						>
							{options
								.filter(({ origin: candidate }) => candidate === groupOrigin)
								.map((option) => (
									<option key={optionKey(option)} value={optionKey(option)}>
										{option.record.name}
									</option>
								))}
						</optgroup>
					))}
				</select>
				<status-dot
					role="status"
					aria-live="polite"
					data-state={layoutState}
					aria-label={`UI layout: ${layoutStatus}`}
				>
					{layoutStatus}
				</status-dot>
			</layout-picker>
			<layout-save>
				<label data-screen-reader htmlFor={`${product}-ui-layout-name`}>
					Layout name
				</label>
				<input
					id={`${product}-ui-layout-name`}
					aria-label="Layout name"
					value={name}
					onChange={(event) => setName(event.currentTarget.value)}
				/>
				<save-destination role="group" aria-label="Save layout to">
					{ORIGINS.map((destination) => (
						<button
							key={destination}
							type="button"
							data-short-label={destination === "project" ? "P" : "H"}
							aria-pressed={origin === destination}
							onClick={() => setOrigin(destination)}
						>
							{destination === "project" ? "Project" : "Home"}
						</button>
					))}
				</save-destination>
				<button
					type="button"
					data-layout-save
					disabled={saving}
					aria-keyshortcuts="S"
					aria-label={`Save layout to ${origin === "project" ? "Project" : "Home"}`}
					onClick={() => void save()}
				>
					<BookmarkFilledIcon aria-hidden="true" />
					<span>{saving ? "Saving…" : "Save"}</span>
				</button>
			</layout-save>
			{error ? (
				<output role="alert" title={error}>
					{error}
				</output>
			) : null}
		</ui-layout-control>
	)
})
