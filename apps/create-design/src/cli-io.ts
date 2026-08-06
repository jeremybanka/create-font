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

export function writeLine(stream: OutputWriter, value: string): void {
	stream.write(`${value}\n`)
}
