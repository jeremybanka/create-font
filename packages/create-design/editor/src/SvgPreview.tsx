import { useEffect, useMemo, useState } from "react"
import {
	createLiveSvgCompiler,
	type LiveSvgCompilationState,
	type SvgExportTarget,
} from "@create-design/svg"
import {
	browserSvgPreviewEnvironment,
	createBrowserSvgPreviewManager,
	type BrowserSvgPreviewState,
} from "./browser-svg-preview.ts"
import css from "./SvgPreview.module.css"
import type { DesignDocument } from "./types.ts"

export function SvgPreview({
	document,
	target,
}: {
	readonly document: DesignDocument
	readonly target: SvgExportTarget
}) {
	const compiler = useMemo(() => createLiveSvgCompiler(), [])
	const manager = useMemo(() => {
		const environment = browserSvgPreviewEnvironment()
		return environment === null
			? null
			: createBrowserSvgPreviewManager(environment)
	}, [])
	const [compilation, setCompilation] = useState<LiveSvgCompilationState>(() =>
		compiler.getState(),
	)
	const [preview, setPreview] = useState<BrowserSvgPreviewState>(
		() =>
			manager?.getState() ?? {
				active: null,
				diagnostic: null,
				pending: null,
				status: "idle",
			},
	)
	useEffect(() => compiler.subscribe(setCompilation), [compiler])
	useEffect(() => manager?.subscribe(setPreview), [manager])
	useEffect(() => {
		compiler.start()
		return () => {
			compiler.stop()
			manager?.dispose()
		}
	}, [compiler, manager])
	useEffect(
		() => compiler.request(document, target),
		[
			compiler,
			document.artboards,
			document.groups,
			document.layers,
			document.objects,
			document.swatches,
			document.title,
			target,
		],
	)
	useEffect(() => {
		if (
			manager === null ||
			compilation.status !== "ready" ||
			compilation.artifact.generation === preview.active?.artifact.generation ||
			compilation.artifact.generation === preview.pending?.artifact.generation
		)
			return
		manager.activate(compilation.artifact)
	}, [
		compilation,
		manager,
		preview.active?.artifact.generation,
		preview.pending?.artifact.generation,
	])
	const diagnostic =
		compilation.status === "failed"
			? (compilation.diagnostics[0] ?? null)
			: preview.status === "failed"
				? preview.diagnostic
				: manager === null
					? {
							message: "This browser cannot create SVG preview resources.",
							stage: "activation" as const,
						}
					: null
	const timings = preview.active?.timings
	const warnings =
		compilation.status === "ready"
			? compilation.artifact.preflight.summary.warnings
			: 0
	const status =
		diagnostic !== null
			? `${diagnostic.stage}: ${diagnostic.message}`
			: preview.status === "loading"
				? preview.active === null
					? "Loading SVG proof…"
					: "Updating SVG proof…"
				: compilation.status === "compiling"
					? preview.active === null
						? "Compiling SVG proof…"
						: "Updating SVG proof…"
					: warnings > 0
						? `SVG ready · ${warnings} warnings`
						: timings === undefined
							? "SVG proof pending"
							: `Live SVG · ${timings.total.toFixed(1)} ms`
	return (
		<svg-preview
			className={css.class}
			data-status={diagnostic === null ? preview.status : "failed"}
		>
			<svg-preview-frame>
				{preview.active === null && preview.pending === null ? (
					<p>Generated SVG output will appear here.</p>
				) : null}
				{preview.active === null ? null : (
					<iframe
						key={preview.active.url}
						src={preview.active.url}
						title="Live SVG proof"
					/>
				)}
				{preview.pending === null ? null : (
					<iframe
						key={preview.pending.url}
						data-pending
						src={preview.pending.url}
						title="Loading live SVG proof"
						onError={() =>
							manager?.didFail(
								preview.pending!,
								new Error("The browser failed to load the generated SVG."),
							)
						}
						onLoad={() => manager?.didLoad(preview.pending!)}
					/>
				)}
			</svg-preview-frame>
			<svg-preview-status title={status}>{status}</svg-preview-status>
			{timings === undefined ? null : (
				<svg-preview-timings>
					<span>queue {timings.queueing.toFixed(1)}</span>
					<span>project {timings.projection.toFixed(1)}</span>
					<span>write {timings.serialization.toFixed(1)}</span>
					<span>activate {timings.activation.toFixed(1)} ms</span>
				</svg-preview-timings>
			)}
		</svg-preview>
	)
}
