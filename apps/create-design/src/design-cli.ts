#!/usr/bin/env node

import { access } from "node:fs/promises"
import { extname, resolve } from "node:path"

import { SourceValidationError } from "@create-art/source-rpc"
import {
	cli,
	help,
	options,
	optional,
	parseBooleanOption,
	parseNumberOption,
	parseStringOption,
} from "comline"
import { z } from "zod/v4"

import { buildDesignProject } from "./build.ts"
import { checkDesignProject, formatStylishCheck } from "./check.ts"
import { type CliIo, defaultIo, writeLine } from "./cli-io.ts"
import {
	DesignPdfPreflightError,
	DesignPdfSourceError,
	exportDesignPdf,
	formatExportDiagnostic,
} from "./pdf-export.ts"
import {
	DesignPngPreflightError,
	DesignPngSourceError,
	exportDesignPng,
	formatPngDiagnostic,
} from "./png-export.ts"
import { isMainModule } from "./runtime.ts"
import { startCreateDesignServer } from "./server.ts"
import {
	DesignSvgPreflightError,
	DesignSvgSourceError,
	exportDesignSvg,
	formatSvgDiagnostic,
} from "./svg-export.ts"
import { selectDesignProject } from "./workspace.ts"

const helpSchema = { help: z.boolean().optional() }
const helpConfig = {
	help: {
		description: "Show command help.",
		example: "--help",
		flag: "h",
		parse: parseBooleanOption,
		required: false,
	},
} as const

const rootConfig = {
	root: {
		description: "Design workspace root.",
		example: "--root=.",
		flag: "r",
		parse: parseStringOption,
		required: false,
	},
} as const

const artboardsConfig = {
	artboards: {
		description: 'PDF/PNG: "all" or IDs. SVG: exactly one artboard ID.',
		example: "--artboards=artboard:page",
		parse: parseStringOption,
		required: false,
	},
} as const

const includeBleedConfig = {
	"include-bleed": {
		description: "Include authored bleed in PDF page media boxes.",
		example: "--include-bleed",
		parse: parseBooleanOption,
		required: false,
	},
} as const

const buildOptions = options(
	"Build a design project as a PDF artifact.",
	z.object({
		...helpSchema,
		artboards: z.string().optional(),
		"include-bleed": z.boolean().optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		...artboardsConfig,
		...includeBleedConfig,
		...rootConfig,
	},
)

const checkOptions = options(
	"Check a design project's source without writing artifacts.",
	z.object({
		...helpSchema,
		format: z.string().optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		format: {
			description: "Diagnostic output format: stylish or json.",
			example: "--format=json",
			flag: "f",
			parse: parseStringOption,
			required: false,
		},
		...rootConfig,
	},
)

const devOptions = options(
	"Start the interactive design workspace server.",
	z.object({
		...helpSchema,
		hostname: z.string().optional(),
		port: z.number().int().min(1).max(65_535).optional(),
		root: z.string().optional(),
	}),
	{
		...helpConfig,
		hostname: {
			description: "Address to bind. Loopback is the default.",
			example: "--hostname=127.0.0.1",
			parse: parseStringOption,
			required: false,
		},
		port: {
			description: "TCP port.",
			example: "--port=3010",
			flag: "p",
			parse: parseNumberOption,
			required: false,
		},
		...rootConfig,
	},
)

const exportOptions = options(
	"Export a design project as PDF, SVG, or PNG.",
	z.object({
		...helpSchema,
		artboards: z.string().optional(),
		background: z.string().optional(),
		force: z.boolean().optional(),
		"include-bleed": z.boolean().optional(),
		output: z.string().optional(),
		root: z.string().optional(),
		scale: z.number().positive().optional(),
	}),
	{
		...helpConfig,
		...artboardsConfig,
		background: {
			description: 'PNG background: "transparent" or #RRGGBB.',
			example: "--background=#ffffff",
			parse: parseStringOption,
			required: false,
		},
		force: {
			description: "Atomically replace an existing output file.",
			example: "--force",
			parse: parseBooleanOption,
			required: false,
		},
		...includeBleedConfig,
		output: {
			description: "Required .pdf, .svg, or .png output path.",
			example: "--output=artifacts/design.pdf",
			flag: "o",
			parse: parseStringOption,
			required: false,
		},
		...rootConfig,
		scale: {
			description: "PNG pixels per document unit.",
			example: "--scale=2",
			parse: parseNumberOption,
			required: false,
		},
	},
)

export const designCli = cli({
	cliName: "design",
	cliDescription:
		"Build and interactively edit designs in a create-design workspace.",
	routes: optional({
		build: optional({ $design: null }),
		check: optional({ $design: null }),
		dev: optional({ $design: null }),
		export: optional({ $design: null }),
		serve: optional({ $design: null }),
	}),
	routeOptions: {
		"": options("Show design help.", z.object(helpSchema), helpConfig),
		build: buildOptions,
		"build/$design": buildOptions,
		check: checkOptions,
		"check/$design": checkOptions,
		dev: devOptions,
		"dev/$design": devOptions,
		export: exportOptions,
		"export/$design": exportOptions,
		serve: devOptions,
		"serve/$design": devOptions,
	},
})

function parseArtboards(
	value: string | undefined,
): readonly string[] | undefined {
	if (value === undefined || value === "all") return
	const ids = value.split(",").map((id) => id.trim())
	if (ids.some((id) => id.length === 0))
		throw new Error(
			'--artboards must be "all" or comma-separated artboard IDs.',
		)
	if (ids.includes("all"))
		throw new Error('--artboards cannot combine "all" with artboard IDs.')
	return Object.freeze([...new Set(ids)])
}

function parseBackground(
	value: string | undefined,
): import("@create-design/png").PngBackground | undefined {
	if (value === undefined) return
	if (value === "transparent") return { kind: "transparent" }
	if (/^#[0-9a-f]{6}$/iu.test(value))
		return {
			kind: "color",
			r: Number.parseInt(value.slice(1, 3), 16),
			g: Number.parseInt(value.slice(3, 5), 16),
			b: Number.parseInt(value.slice(5, 7), 16),
		}
	throw new Error('--background must be "transparent" or #RRGGBB.')
}

function writeSourceDiagnostics(
	io: CliIo,
	diagnostics: readonly {
		code: string
		message: string
		path: string
		unitPath?: string
	}[],
): void {
	for (const diagnostic of diagnostics)
		writeLine(
			io.stderr,
			`error ${diagnostic.code} [${diagnostic.unitPath ?? diagnostic.path}]: ${diagnostic.message}`,
		)
}

export async function runDesignCli(
	args: string[] = ["design", ...process.argv.slice(2)],
	io: CliIo = defaultIo,
): Promise<number> {
	try {
		const { inputs } = designCli(args)
		if (inputs.opts.help || inputs.case === "") {
			writeLine(io.stdout, help(designCli.definition))
			return 0
		}
		const interactive =
			inputs.case === "dev" ||
			inputs.case === "dev/$design" ||
			inputs.case === "serve" ||
			inputs.case === "serve/$design"
		const project = interactive
			? undefined
			: await selectDesignProject(inputs.opts.root, inputs.path[1])
		if (inputs.case === "check" || inputs.case === "check/$design") {
			if (
				inputs.opts.format !== undefined &&
				inputs.opts.format !== "stylish" &&
				inputs.opts.format !== "json"
			)
				throw new Error("Format must be stylish or json.")
			const result = await checkDesignProject(project!.root)
			writeLine(
				inputs.opts.format === "json" ? io.stdout : io.stderr,
				inputs.opts.format === "json"
					? JSON.stringify(result.diagnostics, null, 2)
					: formatStylishCheck(result),
			)
			return result.ok ? 0 : 1
		}
		if (inputs.case === "build" || inputs.case === "build/$design") {
			const artboardIds = parseArtboards(inputs.opts.artboards)
			const result = await buildDesignProject({
				...(artboardIds === undefined ? {} : { artboardIds }),
				...(inputs.opts["include-bleed"] ? { includeBleed: true } : {}),
				root: project!.root,
			})
			for (const diagnostic of result.preflight.diagnostics)
				writeLine(io.stderr, formatExportDiagnostic(diagnostic))
			writeLine(io.stdout, result.output)
			return 0
		}
		if (inputs.case === "export" || inputs.case === "export/$design") {
			const artboardIds = parseArtboards(inputs.opts.artboards)
			const outputValue = inputs.opts.output
			if (outputValue === undefined)
				throw new Error("Export requires --output FILE.")
			const output = resolve(outputValue)
			const includeBleed = inputs.opts["include-bleed"] === true
			const background = parseBackground(inputs.opts.background)
			const extension = extname(output).toLowerCase()
			if (extension === ".png") {
				if (includeBleed)
					throw new Error("--include-bleed is only valid for PDF export.")
				const result = await exportDesignPng({
					...(artboardIds === undefined ? {} : { artboardIds }),
					...(background === undefined ? {} : { background }),
					force: inputs.opts.force === true,
					output,
					root: project!.root,
					...(inputs.opts.scale === undefined
						? {}
						: { scale: inputs.opts.scale }),
				})
				for (const diagnostic of result.preflight.diagnostics)
					writeLine(io.stderr, formatPngDiagnostic(diagnostic))
				writeLine(
					io.stdout,
					`Exported ${result.outputs.length} PNG ${result.outputs.length === 1 ? "image" : "images"} (${result.byteLength} bytes) to ${result.outputs.join(", ")}.`,
				)
				return 0
			}
			if (inputs.opts.scale !== undefined || background !== undefined)
				throw new Error(
					"--scale and --background are only valid for PNG export.",
				)
			if (extension === ".svg") {
				if (includeBleed)
					throw new Error("--include-bleed is only valid for PDF export.")
				const result = await exportDesignSvg({
					...(artboardIds === undefined ? {} : { artboardIds }),
					force: inputs.opts.force === true,
					output,
					root: project!.root,
				})
				for (const diagnostic of result.preflight.diagnostics)
					writeLine(io.stderr, formatSvgDiagnostic(diagnostic))
				writeLine(
					io.stdout,
					`Exported artboard ${result.artboardId} as SVG (${result.byteLength} bytes) to ${result.output}.`,
				)
				return 0
			}
			const result = await exportDesignPdf({
				...(artboardIds === undefined ? {} : { artboardIds }),
				force: inputs.opts.force === true,
				includeBleed,
				output,
				root: project!.root,
			})
			for (const diagnostic of result.preflight.diagnostics)
				writeLine(io.stderr, formatExportDiagnostic(diagnostic))
			writeLine(
				io.stdout,
				`Exported ${result.pages} PDF ${result.pages === 1 ? "page" : "pages"} (${result.byteLength} bytes) to ${result.output}.`,
			)
			return 0
		}

		const assets = resolve(import.meta.dirname, "../dist")
		if (
			!(await access(resolve(assets, "index.html")).then(
				() => true,
				() => false,
			))
		)
			throw new Error(
				"Build create-design before starting its workspace server.",
			)
		const { url } = await startCreateDesignServer({
			assets,
			...(inputs.opts.hostname === undefined
				? {}
				: { hostname: inputs.opts.hostname }),
			...(inputs.opts.port === undefined ? {} : { port: inputs.opts.port }),
			root: resolve(inputs.opts.root ?? process.cwd()),
			...(inputs.path[1] === undefined ? {} : { design: inputs.path[1] }),
		})
		writeLine(io.stdout, `design workspace is serving at ${url.href}`)
		return 0
	} catch (error) {
		if (error instanceof DesignPngPreflightError) {
			for (const diagnostic of error.preflight.diagnostics)
				writeLine(io.stderr, formatPngDiagnostic(diagnostic))
			return 1
		}
		if (error instanceof DesignPngSourceError) {
			writeSourceDiagnostics(io, error.diagnostics)
			return 1
		}
		if (error instanceof DesignSvgPreflightError) {
			for (const diagnostic of error.preflight.diagnostics)
				writeLine(io.stderr, formatSvgDiagnostic(diagnostic))
			return 1
		}
		if (error instanceof DesignSvgSourceError) {
			writeSourceDiagnostics(io, error.diagnostics)
			return 1
		}
		if (error instanceof DesignPdfPreflightError) {
			for (const diagnostic of error.preflight.diagnostics)
				writeLine(io.stderr, formatExportDiagnostic(diagnostic))
			return 1
		}
		if (error instanceof DesignPdfSourceError) {
			writeSourceDiagnostics(io, error.diagnostics)
			return 1
		}
		if (error instanceof SourceValidationError) {
			writeSourceDiagnostics(io, error.issues)
			return 1
		}
		writeLine(io.stderr, error instanceof Error ? error.message : String(error))
		return 1
	}
}

if (isMainModule(import.meta.url)) process.exitCode = await runDesignCli()
