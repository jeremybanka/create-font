import {
	CommandPalette,
	TileButton,
	TileCheckbox,
	TileNumericField,
	TileSelect,
	TileTextField,
	type PaletteCommand,
} from "@create-art/editor"
import { encodeWav, renderFoleyProject } from "@create-foley/audio"
import {
	createFoleyLayer,
	createInitialFoleyProject,
	FOLEY_GENERATORS,
	FOLEY_SAMPLE_RATES,
	FOLEY_WAVEFORMS,
	validateFoleyProject,
	type FoleyGenerator,
	type FoleyLayer,
	type FoleyProject,
} from "@create-foley/source"
import {
	CopyIcon,
	Cross2Icon,
	DownloadIcon,
	MagnifyingGlassIcon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
	ReloadIcon,
	SpeakerLoudIcon,
	SpeakerOffIcon,
} from "@radix-ui/react-icons"
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

import { createAudioPreview } from "./audio-preview.ts"
import type { FoleyEditorBrowserOptions } from "./browser-api.ts"
import css from "./FoleyApplication.module.css"

const STORAGE_KEY = "create-foley.recovery.v1"
const COLORS: Readonly<Record<FoleyGenerator, string>> = {
	impact: "#ff8a5b",
	whoosh: "#70d6b2",
	noise: "#8ab4f8",
	tone: "#d6a5ff",
	crackle: "#ffd166",
}

function download(name: string, bytes: BlobPart, type: string): void {
	const url = URL.createObjectURL(new Blob([bytes], { type }))
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = name
	anchor.click()
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "") || "foley"
}

function updateLayer(
	project: FoleyProject,
	id: string,
	update: (layer: FoleyLayer) => FoleyLayer,
): FoleyProject {
	return { ...project, layers: project.layers.map((layer) => layer.id === id ? update(layer) : layer) }
}

function Waveform({ samples }: { readonly samples: Float32Array }) {
	const width = 800
	const height = 120
	const points: string[] = []
	const columns = 240
	for (let column = 0; column < columns; column += 1) {
		const start = Math.floor((column / columns) * samples.length)
		const end = Math.max(start + 1, Math.floor(((column + 1) / columns) * samples.length))
		let peak = 0
		for (let index = start; index < end; index += 1)
			peak = Math.max(peak, Math.abs(samples[index] ?? 0))
		const x = (column / (columns - 1)) * width
		points.push(`${x},${height / 2 - peak * height * 0.44} ${x},${height / 2 + peak * height * 0.44}`)
	}
	return (
		<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
			<path d={`M ${points.join(" M ")}`} />
		</svg>
	)
}

function meterText(value: number): string {
	if (value <= 0) return "−∞ dB"
	return `${(20 * Math.log10(value)).toFixed(1)} dB`
}

export function FoleyApplication({
	initialProject,
	onSave,
}: FoleyEditorBrowserOptions) {
	const [project, setProject] = useState<FoleyProject>(() => {
		if (initialProject !== undefined) return initialProject
		try {
			const stored = localStorage.getItem(STORAGE_KEY)
			if (stored !== null) return validateFoleyProject(JSON.parse(stored))
		} catch { /* Recovery is best-effort. */ }
		return createInitialFoleyProject()
	})
	const [selectedId, setSelectedId] = useState(project.layers[0]?.id ?? null)
	const [playing, setPlaying] = useState(false)
	const [playhead, setPlayhead] = useState(0)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved")
	const [error, setError] = useState<string | null>(null)
	const startedAt = useRef(0)
	const startedOffset = useRef(0)
	const preview = useRef<ReturnType<typeof createAudioPreview> | null>(null)
	const fileInput = useRef<HTMLInputElement>(null)
	const rendered = useMemo(() => renderFoleyProject(project), [project])
	const selected = project.layers.find((layer) => layer.id === selectedId)

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
		setSaveState("unsaved")
	}, [project])

	useEffect(() => {
		if (!playing) return
		let frame = 0
		const tick = (): void => {
			const elapsed = (performance.now() - startedAt.current) / 1_000
			const next = startedOffset.current + elapsed
			setPlayhead(project.looping ? next % project.duration : Math.min(project.duration, next))
			if (!project.looping && next >= project.duration) {
				setPlaying(false)
				return
			}
			frame = requestAnimationFrame(tick)
		}
		frame = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(frame)
	}, [playing, project.duration, project.looping])

	useEffect(() => {
		const handle = (event: KeyboardEvent): void => {
			const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault()
				void save()
			} else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
				event.preventDefault()
				setPaletteOpen(true)
			} else if (!editing && event.code === "Space") {
				event.preventDefault()
				void togglePlayback()
			} else if (!editing && (event.key === "Backspace" || event.key === "Delete")) {
				event.preventDefault()
				removeSelected()
			}
		}
		window.addEventListener("keydown", handle)
		return () => window.removeEventListener("keydown", handle)
	})

	const stop = useCallback(() => {
		preview.current?.stop()
		setPlaying(false)
	}, [])

	const togglePlayback = async (): Promise<void> => {
		if (playing) {
			stop()
			return
		}
		preview.current ??= createAudioPreview(() => setPlaying(false))
		startedAt.current = performance.now()
		startedOffset.current = playhead >= project.duration ? 0 : playhead
		await preview.current.play(rendered, startedOffset.current, project.looping)
		setPlaying(true)
	}

	const save = async (): Promise<void> => {
		if (onSave === undefined) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
			setSaveState("saved")
			return
		}
		setSaveState("saving")
		setError(null)
		try {
			await onSave(project)
			setSaveState("saved")
		} catch (caught) {
			setSaveState("unsaved")
			setError(caught instanceof Error ? caught.message : String(caught))
		}
	}

	const addLayer = (generator: FoleyGenerator): void => {
		const base = createFoleyLayer(generator, project.layers.length)
		let id = base.id
		let suffix = 2
		while (project.layers.some((layer) => layer.id === id)) id = `${base.id}-${suffix++}`
		const layer = {
			...base,
			id,
			start: Math.min(playhead, Math.max(0, project.duration - base.duration)),
			duration: Math.min(base.duration, project.duration),
		}
		setProject({ ...project, layers: [...project.layers, layer] })
		setSelectedId(layer.id)
	}

	const removeSelected = (): void => {
		if (selectedId === null) return
		const index = project.layers.findIndex((layer) => layer.id === selectedId)
		const layers = project.layers.filter((layer) => layer.id !== selectedId)
		setProject({ ...project, layers })
		setSelectedId(layers[Math.min(index, layers.length - 1)]?.id ?? null)
	}

	const duplicateSelected = (): void => {
		if (selected === undefined) return
		let suffix = 2
		let id = `${selected.id}-copy`
		while (project.layers.some((layer) => layer.id === id)) id = `${selected.id}-copy-${suffix++}`
		const copy = {
			...selected,
			id,
			name: `${selected.name} copy`,
			start: Math.min(project.duration - selected.duration, selected.start + 0.05),
			seed: (selected.seed + 0x9e37_79b9) >>> 0,
		}
		setProject({ ...project, layers: [...project.layers, copy] })
		setSelectedId(id)
	}

	const exportWav = (): void => {
		const wav = encodeWav(rendered)
		download(`${slug(project.title)}.wav`, wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer, "audio/wav")
	}
	const exportJson = (): void =>
		download(`${slug(project.title)}.create-foley.json`, `${JSON.stringify(project, null, "\t")}\n`, "application/json")

	const commands = useMemo<readonly PaletteCommand[]>(() => [
		...FOLEY_GENERATORS.map((generator) => ({
			id: `add-${generator}`,
			displayName: `Add ${generator}`,
			category: "Layer",
			icon: "PlusIcon" as const,
			do: () => addLayer(generator),
		})),
		{ id: "play", displayName: playing ? "Stop preview" : "Play preview", category: "Transport", icon: "CircleIcon", shortcut: "Space", do: () => { void togglePlayback() } },
		{ id: "duplicate", displayName: "Duplicate layer", category: "Layer", icon: "DoubleArrowRightIcon", disabled: selected === undefined, do: duplicateSelected },
		{ id: "export", displayName: "Export WAV", category: "Output", icon: "StarIcon", do: exportWav },
	], [playing, project, selected, playhead, rendered])

	return (
		<foley-application className={css.class}>
			<header>
				<brand-lockup>
					<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 16h4l2-8 4 16 4-20 4 24 3-12h3" /></svg>
					<project-identity><strong>{project.title}</strong><span>create-foley</span></project-identity>
				</brand-lockup>
				<command-center>
					<button type="button" onClick={() => setPaletteOpen(true)}><command-icon><MagnifyingGlassIcon /></command-icon><span>Search commands</span><kbd>⇧⌘P</kbd></button>
				</command-center>
				<header-actions>
					<span data-state={saveState}>{saveState}</span>
					<TileButton compact onClick={() => void save()}>Save</TileButton>
					<TileButton compact tone="primary" onClick={exportWav}><DownloadIcon /> WAV</TileButton>
				</header-actions>
			</header>

			<main>
				<aside aria-label="Layer library">
					<section-title><span>Layers</span><small>{project.layers.length}</small></section-title>
					<layer-list>
						{project.layers.map((layer) => (
							<layer-row key={layer.id} data-selected={layer.id === selectedId || undefined}>
								<button type="button" onClick={() => setSelectedId(layer.id)}>
									<i style={{ background: COLORS[layer.generator] }} />
									<span><strong>{layer.name}</strong><small>{layer.generator} · {layer.duration.toFixed(2)}s</small></span>
								</button>
								<button type="button" aria-label={layer.muted ? `Unmute ${layer.name}` : `Mute ${layer.name}`} onClick={() => setProject(updateLayer(project, layer.id, (value) => ({ ...value, muted: !value.muted })))}>
									<mute-icon>{layer.muted ? <SpeakerOffIcon /> : <SpeakerLoudIcon />}</mute-icon>
								</button>
							</layer-row>
						))}
					</layer-list>
					<add-grid>
						{FOLEY_GENERATORS.map((generator) => <button key={generator} type="button" onClick={() => addLayer(generator)}><PlusIcon />{generator}</button>)}
					</add-grid>
				</aside>

				<workspace-panel>
					<transport-bar>
						<button type="button" onClick={() => void togglePlayback()} aria-label={playing ? "Stop" : "Play"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
						<time-code>{playhead.toFixed(3)} <small>/ {project.duration.toFixed(3)} s</small></time-code>
						<label><input type="checkbox" checked={project.looping} onChange={(event) => setProject({ ...project, looping: event.currentTarget.checked })} /> Loop</label>
						<meter-group><span>Peak {meterText(rendered.peak)}</span><span>RMS {meterText(rendered.rms)}</span></meter-group>
					</transport-bar>
					<waveform-overview onPointerDown={(event) => {
						const bounds = event.currentTarget.getBoundingClientRect()
						setPlayhead(Math.max(0, Math.min(project.duration, ((event.clientX - bounds.left) / bounds.width) * project.duration)))
					}}>
						<Waveform samples={rendered.left} />
						<play-head style={{ left: `${(playhead / project.duration) * 100}%` }} />
					</waveform-overview>
					<foley-timeline>
						<time-ruler>{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ left: `${index * 12.5}%` }}>{(project.duration * index / 8).toFixed(1)}</span>)}</time-ruler>
						{project.layers.map((layer) => (
							<timeline-lane key={layer.id} onClick={() => setSelectedId(layer.id)}>
								<timeline-clip
									data-selected={layer.id === selectedId || undefined}
									data-muted={layer.muted || undefined}
									style={{ left: `${(layer.start / project.duration) * 100}%`, width: `${(layer.duration / project.duration) * 100}%`, borderColor: COLORS[layer.generator], background: `color-mix(in srgb, ${COLORS[layer.generator]} 17%, transparent)` }}
									onPointerDown={(event) => {
										event.currentTarget.setPointerCapture(event.pointerId)
										const startX = event.clientX
										const initial = layer.start
										const lane = event.currentTarget.parentElement
										const move = (moveEvent: PointerEvent): void => {
											if (lane === null) return
											const delta = ((moveEvent.clientX - startX) / lane.clientWidth) * project.duration
											const next = Math.max(0, Math.min(project.duration - layer.duration, initial + delta))
											setProject((value) => updateLayer(value, layer.id, (item) => ({ ...item, start: Math.round(next * 1_000) / 1_000 })))
										}
										const up = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
										window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
									}}
								>
									<strong>{layer.name}</strong><small>{layer.generator}</small>
								</timeline-clip>
							</timeline-lane>
						))}
						<play-head style={{ left: `${(playhead / project.duration) * 100}%` }} />
					</foley-timeline>
				</workspace-panel>

				<aside aria-label="Inspector">
					<section-title><span>Inspector</span>{selected === undefined ? null : <small>{selected.generator}</small>}</section-title>
					{selected === undefined ? <empty-state>Select or add a layer.</empty-state> : (
						<inspector-fields>
							<TileTextField label="Name" value={selected.name} onChange={(event) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, name: event.currentTarget.value })))} />
							<TileSelect label="Generator" value={selected.generator} onChange={(event) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, generator: event.currentTarget.value as FoleyGenerator })))}>{FOLEY_GENERATORS.map((generator) => <option key={generator}>{generator}</option>)}</TileSelect>
							<field-row>
								<TileNumericField label="Start" value={selected.start} min={0} max={project.duration - selected.duration} step="any" onCommit={(start) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, start })))} />
								<TileNumericField label="Duration" value={selected.duration} min={0.01} max={project.duration - selected.start} step="any" onCommit={(duration) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, duration })))} />
							</field-row>
							<field-row>
								<TileNumericField label="Gain" value={selected.gain} min={0} max={4} step="any" onCommit={(gain) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, gain })))} />
								<TileNumericField label="Pan" value={selected.pan} min={-1} max={1} step="any" onCommit={(pan) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, pan })))} />
							</field-row>
							<TileNumericField label="Pitch / color (Hz)" value={selected.pitch} min={20} max={20_000} step="any" onCommit={(pitch) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, pitch })))} />
							<TileSelect label="Waveform" value={selected.waveform} disabled={selected.generator !== "tone"} onChange={(event) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, waveform: event.currentTarget.value as FoleyLayer["waveform"] })))}>{FOLEY_WAVEFORMS.map((waveform) => <option key={waveform}>{waveform}</option>)}</TileSelect>
							<subsection-title>Envelope</subsection-title>
							<field-row>
								<TileNumericField label="Attack" value={selected.envelope.attack} min={0} max={selected.duration} step="any" onCommit={(attack) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, envelope: { ...layer.envelope, attack } })))} />
								<TileNumericField label="Decay" value={selected.envelope.decay} min={0} max={selected.duration} step="any" onCommit={(decay) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, envelope: { ...layer.envelope, decay } })))} />
							</field-row>
							<field-row>
								<TileNumericField label="Sustain" value={selected.envelope.sustain} min={0} max={1} step="any" onCommit={(sustain) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, envelope: { ...layer.envelope, sustain } })))} />
								<TileNumericField label="Release" value={selected.envelope.release} min={0} max={selected.duration} step="any" onCommit={(release) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, envelope: { ...layer.envelope, release } })))} />
							</field-row>
							<subsection-title>Filter</subsection-title>
							<field-row>
								<TileNumericField label="High-pass" value={selected.filter.highpass} min={0} max={20_000} step="any" onCommit={(highpass) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, filter: { ...layer.filter, highpass } })))} />
								<TileNumericField label="Low-pass" value={selected.filter.lowpass} min={20} max={48_000} step="any" onCommit={(lowpass) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, filter: { ...layer.filter, lowpass } })))} />
							</field-row>
							<field-row><TileCheckbox label="Mute" checked={selected.muted} onChange={(event) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, muted: event.currentTarget.checked })))} /><TileCheckbox label="Solo" checked={selected.solo} onChange={(event) => setProject(updateLayer(project, selected.id, (layer) => ({ ...layer, solo: event.currentTarget.checked })))} /></field-row>
							<action-row><TileButton compact onClick={duplicateSelected}><CopyIcon /> Duplicate</TileButton><TileButton compact tone="danger" onClick={removeSelected}><Cross2Icon /> Delete</TileButton></action-row>
						</inspector-fields>
					)}
					<section-title><span>Project</span></section-title>
					<inspector-fields>
						<TileTextField label="Title" value={project.title} onChange={(event) => setProject({ ...project, title: event.currentTarget.value })} />
						<TileNumericField label="Duration (s)" value={project.duration} min={0.1} max={300} step="any" onCommit={(duration) => setProject({ ...project, duration, layers: project.layers.map((layer) => ({ ...layer, start: Math.min(layer.start, Math.max(0, duration - 0.01)), duration: Math.min(layer.duration, Math.max(0.01, duration - Math.min(layer.start, duration - 0.01))) })) })} />
						<TileSelect label="Sample rate" value={project.sampleRate} onChange={(event) => setProject({ ...project, sampleRate: Number(event.currentTarget.value) as FoleyProject["sampleRate"] })}>{FOLEY_SAMPLE_RATES.map((rate) => <option key={rate} value={rate}>{rate / 1_000} kHz</option>)}</TileSelect>
						<TileNumericField label="Master gain" value={project.masterGain} min={0} max={2} step="any" onCommit={(masterGain) => setProject({ ...project, masterGain })} />
						<TileNumericField label="Loop crossfade (s)" value={project.loopCrossfade} min={0} max={project.duration / 2} step="any" onCommit={(loopCrossfade) => setProject({ ...project, loopCrossfade })} />
						<action-row><TileButton compact onClick={exportJson}><DownloadIcon /> Source</TileButton><TileButton compact onClick={() => fileInput.current?.click()}><ReloadIcon /> Import</TileButton></action-row>
					</inspector-fields>
				</aside>
			</main>
			<footer><span>{project.sampleRate / 1_000} kHz · 24-bit WAV · stereo</span><span>{error ?? "Deterministic procedural mix"}</span></footer>
			<input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
				const file = event.currentTarget.files?.[0]
				if (file === undefined) return
				void file.text().then((text) => { const imported = validateFoleyProject(JSON.parse(text)); stop(); setProject(imported); setSelectedId(imported.layers[0]?.id ?? null); setError(null) }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
			}} />
			{paletteOpen ? <CommandPalette commands={commands} onCancel={() => setPaletteOpen(false)} onAssign={() => {}} onExecute={(command) => { setPaletteOpen(false); command.do() }} /> : null}
		</foley-application>
	)
}
