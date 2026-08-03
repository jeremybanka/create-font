export const PREVIEW_SAMPLES = {
	lorem:
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
	cicero:
		"But I must explain to you how all this mistaken idea of denouncing pleasure and praising pain was born, and I will give you a complete account of the system, and expound the actual teachings of the great explorer of the truth, the master-builder of human happiness.",
	pi: "3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989".slice(
		0,
		1_001,
	),
	nato: "Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu",
} as const

export type PreviewSampleId = keyof typeof PREVIEW_SAMPLES | "custom" | "noise"

/**
 * Repeats only the supplied Unicode glyphs using a stable random cadence.
 * Duplicate input glyphs are retained as weights: `nne` makes n twice as
 * likely as e.
 */
export function generateGlyphNoise(seed: string, minimumLength = 384): string {
	const glyphs = Array.from(seed.replaceAll(/\s/g, ""))
	if (glyphs.length === 0 || minimumLength <= 0) return ""
	let state = glyphs.reduce(
		(value, glyph, index) =>
			(value ^ ((glyph.codePointAt(0) ?? 0) + index * 2_654_435_761)) >>> 0,
		2_166_136_261,
	)
	let result = ""
	let length = 0
	while (length < minimumLength) {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
		result += glyphs[state % glyphs.length] ?? glyphs[0]
		length++
	}
	return result
}

export function estimateNoiseCharacterCount({
	width,
	height,
	fontSize,
	lineHeight,
}: Readonly<{
	width: number
	height: number
	fontSize: number
	lineHeight: number
}>): number {
	const safeFontSize = Math.max(1, fontSize)
	const columns = Math.ceil(Math.max(0, width) / (safeFontSize * 0.58))
	const rows = Math.ceil(
		Math.max(0, height) / (safeFontSize * Math.max(0.1, lineHeight)),
	)
	return Math.min(2_048, Math.max(384, Math.ceil(columns * rows * 1.35)))
}

export function previewColorDefault(prefersLight: boolean): "dark" | "light" {
	return prefersLight ? "light" : "dark"
}
