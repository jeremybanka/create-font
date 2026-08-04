import { useEffect, useMemo, useState } from "react"
import {
	createLivePngCompiler,
	type LivePngCompilationState,
	type PngExportRequest,
} from "@create-design/png"
import type { DesignDocument } from "./types.ts"
import css from "./PngPreview.module.css"
import { createPngWorkerClient } from "./png-worker-client.ts"

export function PngPreview({
	document,
	request,
}: Readonly<{
	document: DesignDocument
	request: PngExportRequest
}>) {
	const worker = useMemo(() => createPngWorkerClient(), [])
	const compiler = useMemo(
		() =>
			createLivePngCompiler({
				compile(document, request, options) {
					const task = worker.rasterize(document, request)
					options?.signal?.addEventListener("abort", task.cancel, {
						once: true,
					})
					return task.promise
				},
			}),
		[worker],
	)
	const [state, setState] = useState<LivePngCompilationState>(() =>
		compiler.getState(),
	)
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => compiler.subscribe(setState), [compiler])
	useEffect(() => {
		compiler.start()
		return () => {
			compiler.stop()
			worker.dispose()
		}
	}, [compiler, worker])
	useEffect(
		() => compiler.request(document, request),
		[compiler, document, request],
	)
	useEffect(() => {
		if (state.status !== "ready") return
		const first = state.artifact.result.artifacts[0]
		if (first === undefined) return
		const next = URL.createObjectURL(
			new Blob([new Uint8Array(first.bytes).buffer], { type: "image/png" }),
		)
		setUrl((previous) => {
			if (previous !== null) URL.revokeObjectURL(previous)
			return next
		})
		return () => URL.revokeObjectURL(next)
	}, [state.status === "ready" ? state.artifact.generation : -1])
	useEffect(
		() => () => {
			if (url !== null) URL.revokeObjectURL(url)
		},
		[url],
	)
	const status =
		state.status === "failed"
			? (state.diagnostics[0]?.message ?? "PNG preview failed.")
			: state.status === "compiling"
				? "Rasterizing PNG proof…"
				: state.status === "ready"
					? `Live PNG · ${state.artifact.timings.total.toFixed(1)} ms`
					: "PNG proof pending"
	return (
		<png-preview className={css.class} data-status={state.status}>
			<png-preview-frame>
				{url === null ? (
					<p>Generated PNG output will appear here.</p>
				) : (
					<img src={url} alt="Live PNG proof" />
				)}
			</png-preview-frame>
			<png-preview-status>{status}</png-preview-status>
		</png-preview>
	)
}
