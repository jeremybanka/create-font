export function optionValue(args: readonly string[], name: string): string | undefined {
	const prefix = `${name}=`
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index]
		if (value?.startsWith(prefix)) return value.slice(prefix.length)
		if (value === name) return args[index + 1]
	}
	return undefined
}

export function positional(args: readonly string[]): readonly string[] {
	const output: string[] = []
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index]!
		if (value.startsWith("--")) {
			if (!value.includes("=") && ["--root", "--output", "--port", "--hostname", "--package-manager"].includes(value)) index += 1
			continue
		}
		output.push(value)
	}
	return output
}
