import { useEffect, useMemo, useState } from "preact/hooks"

import {
	browserPdfPreviewEnvironment,
	createBrowserPdfPreviewManager,
	type BrowserPdfPreviewState,
} from "./browser-pdf-preview.ts"
import {
	createLivePdfCompiler,
	type LivePdfCompilationState,
} from "@create-design/pdf"
import css from "./PdfPreview.module.css"
import { activeDesignArtboard } from "@create-design/model"
import type { ExportPreflightPreferences } from "@create-design/pdf"
import type { PdfExportTarget } from "@create-design/pdf"
import type { DesignArtboard, DesignDocument } from "./types.ts"

export function PdfPreview({
	document,
	artboard,
	target = artboard ?? activeDesignArtboard(document),
	preflightPreferences,
}: {
	readonly document: DesignDocument
	readonly artboard?: DesignArtboard
	readonly preflightPreferences?: ExportPreflightPreferences
	readonly target?: PdfExportTarget
}) {
	const compiler = useMemo(() => createLivePdfCompiler(), [])
	const manager = useMemo(() => {
		const environment = browserPdfPreviewEnvironment()
		return environment === null
			? null
			: createBrowserPdfPreviewManager(environment)
	}, [])
	const [compilation, setCompilation] = useState<LivePdfCompilationState>(() =>
		compiler.getState(),
	)
	const [preview, setPreview] = useState<BrowserPdfPreviewState>(
		() =>
			manager?.getState() ?? {
				active: null,
				diagnostic: null,
				pending: null,
				status: "idle",
			},
	)

	useEffect(() => compiler.subscribe(setCompilation), [compiler])
	useEffect(
		() => (manager === null ? undefined : manager.subscribe(setPreview)),
		[manager],
	)
	useEffect(() => {
		compiler.start()
		return () => {
			compiler.stop()
			manager?.dispose()
		}
	}, [compiler, manager])
	useEffect(() => {
		compiler.request(document, target, preflightPreferences)
	}, [
		compiler,
		document.artboards,
		document.objects,
		document.swatches,
		document.title,
		preflightPreferences,
		target,
	])
	useEffect(() => {
		if (
			manager === null ||
			compilation.status !== "ready" ||
			compilation.artifact.generation === preview.active?.artifact.generation ||
			compilation.artifact.generation === preview.pending?.artifact.generation
		) {
			return
		}
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
							message: "This browser cannot create PDF preview resources.",
							stage: "activation" as const,
						}
					: null
	const timings = preview.active?.timings
	const readyWarnings =
		compilation.status === "ready"
			? compilation.artifact.preflight.summary.warnings
			: 0
	const readyNotices =
		compilation.status === "ready"
			? compilation.artifact.preflight.summary.infos
			: 0
	const status =
		diagnostic === null
			? preview.status === "loading"
				? preview.active === null
					? "Loading PDF proof…"
					: "Updating PDF proof…"
				: compilation.status === "compiling"
					? preview.active === null
						? "Compiling PDF proof…"
						: "Updating PDF proof…"
					: readyWarnings + readyNotices > 0
						? `PDF ready · ${readyWarnings} warnings · ${readyNotices} notices`
						: timings === undefined
							? "PDF proof pending"
							: `Live PDF · ${timings.total.toFixed(1)} ms`
			: `${diagnostic.stage}: ${diagnostic.message}`

	return (
		<pdf-preview
			className={css.class}
			data-status={diagnostic === null ? preview.status : "failed"}
		>
			<pdf-preview-frame>
				{preview.active === null && preview.pending === null ? (
					<p>Generated PDF output will appear here.</p>
				) : null}
				{preview.active === null ? null : (
					<iframe
						key={preview.active.url}
						src={preview.active.url}
						title="Live PDF proof"
					/>
				)}
				{preview.pending === null ? null : (
					<iframe
						key={preview.pending.url}
						data-pending
						src={preview.pending.url}
						title="Loading live PDF proof"
						onError={() =>
							manager?.didFail(
								preview.pending!,
								new Error(
									"The browser PDF viewer failed to load the generated PDF.",
								),
							)
						}
						onLoad={() => manager?.didLoad(preview.pending!)}
					/>
				)}
			</pdf-preview-frame>
			<pdf-preview-status title={status}>{status}</pdf-preview-status>
			{timings === undefined ? null : (
				<pdf-preview-timings>
					<span>queue {timings.queueing.toFixed(1)}</span>
					<span>project {timings.projection.toFixed(1)}</span>
					<span>
						validate/write {timings.validationAndSerialization.toFixed(1)}
					</span>
					<span>activate {timings.activation.toFixed(1)} ms</span>
				</pdf-preview-timings>
			)}
		</pdf-preview>
	)
}
