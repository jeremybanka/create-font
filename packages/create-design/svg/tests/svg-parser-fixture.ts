export interface ParsedSvgFixture {
	readonly elementNames: readonly string[]
	readonly rootAttributes: Readonly<Record<string, string>>
}

/** A deliberately independent structural reader for deterministic SVG fixtures. */
export function parseSvgFixture(source: string): ParsedSvgFixture {
	if (!source.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'))
		throw new Error("Missing canonical XML declaration.")
	const tags = source.match(/<\/?[^>]+>/gu) ?? []
	const stack: string[] = []
	const names: string[] = []
	let rootAttributes: Record<string, string> | undefined
	for (const tag of tags) {
		if (tag.startsWith("<?")) continue
		if (tag.startsWith("</")) {
			const name = /^<\/([^\s>]+)/u.exec(tag)?.[1]
			if (name === undefined || stack.pop() !== name)
				throw new Error(`Mismatched closing tag ${tag}.`)
			continue
		}
		const parsed = /^<([^\s/>]+)([^>]*)>/u.exec(tag)
		if (parsed === null) throw new Error(`Malformed tag ${tag}.`)
		const [, name, rawAttributes] = parsed
		names.push(name!)
		if (rootAttributes === undefined && name === "svg") {
			rootAttributes = {}
			for (const attribute of rawAttributes!.matchAll(/([^\s=]+)="([^"]*)"/gu))
				rootAttributes[attribute[1]!] = attribute[2]!
		}
		if (!tag.endsWith("/>")) stack.push(name!)
	}
	if (stack.length > 0) throw new Error(`Unclosed tag ${stack.at(-1)}.`)
	if (rootAttributes === undefined) throw new Error("Missing SVG root.")
	return { elementNames: names, rootAttributes }
}
