export type StartupContext = `browser-main` | `shared-worker`

export type StartupPhase = Readonly<{
	duration: number
	name: string
	start: number
}>

export type StartupTimelineSnapshot = Readonly<{
	context: StartupContext
	milestones: Readonly<Record<string, number>>
	phases: readonly StartupPhase[]
	timeOrigin: number
}>

export type StartupResourceTiming = Readonly<{
	duration: number
	encodedBodySize: number
	initiatorType: string
	name: string
	start: number
	transferSize: number
}>

export type StartupClock = Readonly<{
	now(): number
	timeOrigin: number
}>

export type StartupTimeline = Readonly<{
	mark(name: string): number
	snapshot(): StartupTimelineSnapshot
	startPhase(name: string): () => StartupPhase
}>

export function createStartupTimeline(
	context: StartupContext,
	clock: StartupClock = performance,
): StartupTimeline {
	const milestones: Record<string, number> = {}
	const phases: StartupPhase[] = []

	return {
		mark(name) {
			const at = clock.now()
			milestones[name] = at
			return at
		},
		startPhase(name) {
			const start = clock.now()
			let result: StartupPhase | undefined
			return () => {
				if (result !== undefined) return result
				result = Object.freeze({
					duration: Math.max(0, clock.now() - start),
					name,
					start,
				})
				phases.push(result)
				return result
			}
		},
		snapshot() {
			return Object.freeze({
				context,
				milestones: Object.freeze({ ...milestones }),
				phases: Object.freeze([...phases]),
				timeOrigin: clock.timeOrigin,
			})
		},
	}
}

export function startupEpochMilliseconds(
	timeline: StartupTimelineSnapshot,
	milestone: string,
): number | undefined {
	const relative = timeline.milestones[milestone]
	return relative === undefined ? undefined : timeline.timeOrigin + relative
}

export function startupTransitDuration(
	sentAtEpochMilliseconds: number,
	receivedAtEpochMilliseconds: number,
): number {
	return Math.max(0, receivedAtEpochMilliseconds - sentAtEpochMilliseconds)
}

export function startupResourceTimings(
	entries: readonly PerformanceEntry[],
): readonly StartupResourceTiming[] {
	return Object.freeze(
		entries.map((entry) => {
			const resource = entry as PerformanceResourceTiming
			return Object.freeze({
				duration: entry.duration,
				encodedBodySize: resource.encodedBodySize ?? 0,
				initiatorType: resource.initiatorType ?? `unknown`,
				name: entry.name,
				start: entry.startTime,
				transferSize: resource.transferSize ?? 0,
			})
		}),
	)
}
