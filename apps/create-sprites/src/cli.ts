export function optionValue(argv: readonly string[], name: string): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === name) return argv[index + 1]
		if (argument?.startsWith(`${name}=`)) return argument.slice(name.length + 1)
	}
	return undefined
}

export function positionalArguments(argv: readonly string[]): readonly string[] {
	const positions: string[] = []
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === undefined) continue
		if (argument.startsWith("--") && !argument.includes("=")) { index += 1; continue }
		if (!argument.startsWith("--")) positions.push(argument)
	}
	return positions
}

export function integerOption(argv: readonly string[], name: string, fallback: number): number {
	const raw = optionValue(argv, name)
	if (raw === undefined) return fallback
	const value = Number(raw)
	if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`)
	return value
}
