import { z } from "zod/v4"

export const CREATE_FOLEY_FORMAT = "create-foley.project" as const
export const CREATE_FOLEY_VERSION = 1 as const
export const FOLEY_SAMPLE_RATES = [44_100, 48_000, 96_000] as const
export const FOLEY_GENERATORS = [
	"impact",
	"whoosh",
	"noise",
	"tone",
	"crackle",
] as const
export const FOLEY_WAVEFORMS = ["sine", "triangle", "square", "sawtooth"] as const

const finite = z.number().finite()
export const foleyEnvelopeSchema = z
	.object({
		attack: finite.min(0).max(30),
		decay: finite.min(0).max(30),
		sustain: finite.min(0).max(1),
		release: finite.min(0).max(30),
	})
	.strict()

export const foleyFilterSchema = z
	.object({
		highpass: finite.min(0).max(20_000),
		lowpass: finite.min(20).max(48_000),
	})
	.strict()

export const foleyLayerSchema = z
	.object({
		id: z.string().regex(/^layer:.+/u),
		name: z.string().max(120),
		generator: z.enum(FOLEY_GENERATORS),
		start: finite.min(0).max(300),
		duration: finite.positive().max(300),
		gain: finite.min(0).max(4),
		pan: finite.min(-1).max(1),
		pitch: finite.min(20).max(20_000),
		seed: z.number().int().min(0).max(0xffff_ffff),
		muted: z.boolean(),
		solo: z.boolean(),
		waveform: z.enum(FOLEY_WAVEFORMS),
		envelope: foleyEnvelopeSchema,
		filter: foleyFilterSchema,
	})
	.strict()

export const foleyProjectSchema = z
	.object({
		format: z.literal(CREATE_FOLEY_FORMAT),
		version: z.literal(CREATE_FOLEY_VERSION),
		title: z.string().max(160),
		description: z.string().max(800),
		duration: finite.positive().max(300),
		sampleRate: z.union([
			z.literal(44_100),
			z.literal(48_000),
			z.literal(96_000),
		]),
		looping: z.boolean(),
		loopCrossfade: finite.min(0).max(5),
		masterGain: finite.min(0).max(2),
		layers: z.array(foleyLayerSchema).max(64),
	})
	.strict()
	.superRefine((project, context) => {
		const ids = new Set<string>()
		for (const [index, layer] of project.layers.entries()) {
			if (ids.has(layer.id))
				context.addIssue({
					code: "custom",
					message: `Duplicate layer ID ${layer.id}.`,
					path: ["layers", index, "id"],
				})
			ids.add(layer.id)
			if (layer.start + layer.duration > project.duration + 0.000_001)
				context.addIssue({
					code: "custom",
					message: "Layer extends beyond the project duration.",
					path: ["layers", index, "duration"],
				})
		}
		if (project.loopCrossfade > project.duration / 2)
			context.addIssue({
				code: "custom",
				message: "Loop crossfade cannot exceed half the project duration.",
				path: ["loopCrossfade"],
			})
	})

export type FoleyEnvelope = z.infer<typeof foleyEnvelopeSchema>
export type FoleyFilter = z.infer<typeof foleyFilterSchema>
export type FoleyLayer = z.infer<typeof foleyLayerSchema>
export type FoleyProject = z.infer<typeof foleyProjectSchema>
export type FoleyGenerator = FoleyLayer["generator"]

export function validateFoleyProject(value: unknown): FoleyProject {
	return foleyProjectSchema.parse(value)
}

export function parseFoleyProjectText(text: string): FoleyProject {
	return validateFoleyProject(JSON.parse(text) as unknown)
}

export function createFoleyLayer(
	generator: FoleyGenerator,
	index = 0,
): FoleyLayer {
	const names: Record<FoleyGenerator, string> = {
		impact: "Impact",
		whoosh: "Whoosh",
		noise: "Texture",
		tone: "Tone",
		crackle: "Crackle",
	}
	const duration = generator === "whoosh" || generator === "noise" ? 2 : 0.7
	return {
		id: `layer:${generator}-${index + 1}`,
		name: names[generator],
		generator,
		start: 0,
		duration,
		gain: generator === "impact" ? 0.9 : 0.55,
		pan: 0,
		pitch: generator === "impact" ? 90 : generator === "tone" ? 220 : 700,
		seed: (0x9e37_79b9 * (index + 1)) >>> 0,
		muted: false,
		solo: false,
		waveform: "sine",
		envelope: {
			attack: generator === "whoosh" ? 0.35 : 0.003,
			decay: generator === "impact" ? 0.24 : 0.2,
			sustain: generator === "noise" || generator === "whoosh" ? 0.68 : 0.2,
			release: generator === "whoosh" || generator === "noise" ? 0.4 : 0.18,
		},
		filter: {
			highpass: generator === "impact" ? 28 : 80,
			lowpass: generator === "impact" ? 6_500 : 9_000,
		},
	}
}

export function createInitialFoleyProject(title = "Untitled foley"): FoleyProject {
	const impact = createFoleyLayer("impact", 0)
	const crackle = {
		...createFoleyLayer("crackle", 1),
		name: "Debris",
		start: 0.04,
		duration: 0.9,
		gain: 0.38,
		pitch: 1_800,
		pan: 0.12,
	}
	const tail = {
		...createFoleyLayer("noise", 2),
		name: "Room tail",
		start: 0.08,
		duration: 1.7,
		gain: 0.16,
		pitch: 520,
		filter: { highpass: 160, lowpass: 3_200 },
	}
	return {
		format: CREATE_FOLEY_FORMAT,
		version: CREATE_FOLEY_VERSION,
		title,
		description: "A layered cinematic impact built from deterministic procedural sources.",
		duration: 2.4,
		sampleRate: 48_000,
		looping: false,
		loopCrossfade: 0.08,
		masterGain: 0.9,
		layers: [impact, crackle, tail],
	}
}

type ProjectHeader = Omit<FoleyProject, "layers">
type LayerIndex = Readonly<{ layers: readonly { id: string; path: string }[] }>

export function layerUnitPath(id: string): string {
	return `layers/${encodeURIComponent(id)}.json`
}

export function splitFoleyProject(projectInput: FoleyProject): ReadonlyMap<string, string> {
	const project = validateFoleyProject(projectInput)
	const { layers, ...header } = project
	const files = new Map<string, string>()
	files.set("create-foley.json", `${JSON.stringify(header, null, "\t")}\n`)
	const index: LayerIndex = {
		layers: layers.map((layer) => ({ id: layer.id, path: layerUnitPath(layer.id) })),
	}
	files.set("layers/index.json", `${JSON.stringify(index, null, "\t")}\n`)
	for (const layer of layers)
		files.set(layerUnitPath(layer.id), `${JSON.stringify(layer, null, "\t")}\n`)
	return files
}

export function assembleFoleyProject(
	files: ReadonlyMap<string, string>,
): FoleyProject {
	const headerText = files.get("create-foley.json")
	const indexText = files.get("layers/index.json")
	if (headerText === undefined) throw new Error("Missing create-foley.json.")
	if (indexText === undefined) throw new Error("Missing layers/index.json.")
	const header = JSON.parse(headerText) as ProjectHeader
	const index = z
		.object({
			layers: z.array(
				z.object({ id: z.string(), path: z.string().regex(/^layers\/.+\.json$/u) }).strict(),
			),
		})
		.strict()
		.parse(JSON.parse(indexText) as unknown)
	const layers = index.layers.map(({ id, path }) => {
		const text = files.get(path)
		if (text === undefined) throw new Error(`Missing layer source ${path}.`)
		const layer = foleyLayerSchema.parse(JSON.parse(text) as unknown)
		if (layer.id !== id) throw new Error(`Layer index ID ${id} does not match ${path}.`)
		return layer
	})
	return validateFoleyProject({ ...header, layers })
}
