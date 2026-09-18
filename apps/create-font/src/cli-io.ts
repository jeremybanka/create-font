import { formatWarnings, type CliWarning } from "comline"

export type OutputWriter = Readonly<{
	write: (value: string) => unknown
}>

export type CliIo = Readonly<{
	stderr: OutputWriter
	stdout: OutputWriter
}>

export const defaultIo: CliIo = {
	stderr: process.stderr,
	stdout: process.stdout,
}

export function writeLine(stream: OutputWriter, value: string) {
	stream.write(`${value}\n`)
}

export function writeWarnings(
	stream: OutputWriter,
	warnings: readonly CliWarning[],
): void {
	const formatted = formatWarnings(warnings, { forceColor: false })
	if (formatted) writeLine(stream, formatted)
}
