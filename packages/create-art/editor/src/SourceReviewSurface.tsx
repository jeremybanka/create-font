import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"
import type { ReactNode } from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import css from "./SourceReviewSurface.module.css"
import { TileButton } from "./TileButton.tsx"
import {
	selectedSourceReviewPaths,
	sourceReviewChangeKey,
	sourceReviewCounts,
	type SourceReviewAdapter,
	type SourceReviewChange,
	type SourceReviewController,
} from "./source-review.ts"

const svg = {
	Check: CheckIcon,
	Cross: Cross2Icon,
}

export interface SourceReviewSurfaceProps<
	Change extends SourceReviewChange = SourceReviewChange,
> {
	readonly controller?: SourceReviewController<Change>
	readonly renderChange?: (change: Change) => ReactNode
	readonly review?: SourceReviewAdapter<Change>
	readonly visualComparison?: ReactNode
}

/**
 * Shared comparison, semantic-row, selection, and guarded-commit behavior.
 *
 * Applications wrap this surface in their own registered tile and supply
 * review navigation plus any product-owned visual comparison controls through
 * `review` and `visualComparison`.
 */
export function SourceReviewSurface<Change extends SourceReviewChange>({
	controller,
	renderChange,
	review,
	visualComparison,
}: SourceReviewSurfaceProps<Change>) {
	const comparison = controller?.comparison
	const changes = comparison?.changes ?? []
	const counts = sourceReviewCounts(changes)
	const [baseRef, setBaseRef] = useState("HEAD")
	const [targetRef, setTargetRef] = useState("")
	const [commitOpen, setCommitOpen] = useState(false)
	const [step, setStep] = useState<"select" | "message">("select")
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
	const [message, setMessage] = useState("")
	const [commitError, setCommitError] = useState<string | null>(null)
	const [committing, setCommitting] = useState(false)
	const startCommitRef = useRef<HTMLButtonElement>(null)
	const closeCommitRef = useRef<HTMLButtonElement>(null)
	const messageRef = useRef<HTMLTextAreaElement>(null)
	const commitTitleId = useId()
	const keys = useMemo(() => changes.map(sourceReviewChangeKey), [changes])

	useEffect(() => {
		setSelected(
			(current) => new Set([...current].filter((key) => keys.includes(key))),
		)
	}, [keys.join("\0")])

	useEffect(() => {
		if (!commitOpen) return
		const frame = requestAnimationFrame(() => {
			if (step === "select") closeCommitRef.current?.focus()
			else messageRef.current?.focus()
		})
		return () => cancelAnimationFrame(frame)
	}, [commitOpen, step])

	const closeCommit = (): void => {
		setCommitOpen(false)
		requestAnimationFrame(() => startCommitRef.current?.focus())
	}
	const openCommit = (): void => {
		setSelected(new Set(keys))
		setStep("select")
		setCommitError(null)
		setCommitOpen(true)
	}
	const selectedChanges = changes.filter((change) =>
		selected.has(sourceReviewChangeKey(change)),
	)
	const selectedPaths = selectedSourceReviewPaths(changes, selected)
	const remaining = changes.length - selectedChanges.length

	return (
		<source-review-surface className={css.class}>
			<comparison-controls>
				<label>
					<span>Reference ref</span>
					<input
						value={baseRef}
						aria-label="Reference Git ref"
						onInput={(event) => setBaseRef(event.currentTarget.value)}
					/>
				</label>
				<label>
					<span>Target ref</span>
					<input
						value={targetRef}
						placeholder="Working source"
						aria-label="Target Git ref, blank for working source"
						onInput={(event) => setTargetRef(event.currentTarget.value)}
					/>
				</label>
				<TileButton
					data-source-review-compare
					type="button"
					tone="primary"
					disabled={controller === undefined || controller.loading}
					onClick={() =>
						void controller?.onCompare(
							baseRef.trim(),
							targetRef.trim() || undefined,
						)
					}
				>
					Compare
				</TileButton>
			</comparison-controls>
			<comparison-status role="status" aria-live="polite">
				{controller === undefined
					? "Version control is unavailable in this editor session."
					: controller.loading
						? "Loading source changes…"
						: controller.error !== undefined
							? controller.error
							: comparison === undefined
								? "No comparison loaded."
								: `${comparison.base.label} → ${comparison.target.label}`}
			</comparison-status>
			{visualComparison === undefined ? null : (
				<source-review-extension>{visualComparison}</source-review-extension>
			)}
			{comparison === undefined ? null : (
				<>
					<change-counts aria-label={`${changes.length} source changes`}>
						<data value={counts.total}>{counts.total} total</data>
						<span>{counts.added} added</span>
						<span>{counts.modified} modified</span>
						<span>{counts.deleted} deleted</span>
					</change-counts>
					{changes.length === 0 ? (
						<empty-changes>
							<svg.Check aria-hidden="true" />
							<span>No source differences</span>
						</empty-changes>
					) : (
						<ul aria-label="Changed source units">
							{changes.map((change) => {
								const reviewable =
									review !== undefined && (review.canReview?.(change) ?? true)
								return (
									<li
										key={sourceReviewChangeKey(change)}
										data-change={change.change}
									>
										<button
											type="button"
											disabled={!reviewable}
											aria-label={
												reviewable
													? (review.reviewLabel?.(change) ??
														`Review ${change.label}`)
													: undefined
											}
											onClick={() =>
												reviewable ? review.review(change) : undefined
											}
										>
											<i aria-hidden="true" />
											<span>{renderChange?.(change) ?? change.label}</span>
											<small>{change.change}</small>
										</button>
									</li>
								)
							})}
						</ul>
					)}
					<button
						ref={startCommitRef}
						type="button"
						disabled={
							changes.length === 0 || comparison.target.kind !== "working"
						}
						onClick={openCommit}
					>
						Start Commit
					</button>
					{comparison.target.kind !== "working" ? (
						<small>
							Commits are only available for the working-source comparison.
						</small>
					) : null}
				</>
			)}
			{!commitOpen || comparison === undefined ? null : (
				<dialog
					open
					aria-modal="true"
					aria-labelledby={commitTitleId}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return
						event.preventDefault()
						closeCommit()
					}}
				>
					<form method="dialog" onSubmit={(event) => event.preventDefault()}>
						<commit-dialog-heading>
							<strong id={commitTitleId}>
								{step === "select" ? "Select source units" : "Commit message"}
							</strong>
							<button
								ref={closeCommitRef}
								type="button"
								aria-label="Close commit dialog"
								onClick={closeCommit}
							>
								<svg.Cross aria-hidden="true" />
							</button>
						</commit-dialog-heading>
						{step === "select" ? (
							<>
								<selection-actions>
									<button
										type="button"
										onClick={() => setSelected(new Set(keys))}
									>
										Select all
									</button>
									<button type="button" onClick={() => setSelected(new Set())}>
										Clear
									</button>
								</selection-actions>
								<ul>
									{changes.map((change) => {
										const key = sourceReviewChangeKey(change)
										return (
											<li key={key}>
												<label>
													<input
														type="checkbox"
														checked={selected.has(key)}
														onChange={(event) => {
															const next = new Set(selected)
															if (event.currentTarget.checked) next.add(key)
															else next.delete(key)
															setSelected(next)
														}}
													/>
													<span>{change.label}</span>
													<small>{change.change}</small>
												</label>
											</li>
										)
									})}
								</ul>
								<p>
									{remaining} source unit{remaining === 1 ? "" : "s"} will
									remain uncommitted.
								</p>
								<commit-dialog-actions>
									<button type="button" onClick={closeCommit}>
										Cancel
									</button>
									<button
										type="button"
										disabled={selectedChanges.length === 0}
										onClick={() => setStep("message")}
									>
										Continue
									</button>
								</commit-dialog-actions>
							</>
						) : (
							<>
								<p>
									Committing {selectedChanges.length} source unit
									{selectedChanges.length === 1 ? "" : "s"}; {remaining} will
									remain.
								</p>
								<ul aria-label="Nominated source units">
									{selectedChanges.map((change) => (
										<li key={sourceReviewChangeKey(change)}>{change.label}</li>
									))}
								</ul>
								<label>
									<span>Commit message</span>
									<textarea
										ref={messageRef}
										value={message}
										onInput={(event) => setMessage(event.currentTarget.value)}
									/>
								</label>
								{commitError === null ? null : (
									<p role="alert">{commitError}</p>
								)}
								<commit-dialog-actions>
									<button
										type="button"
										disabled={committing}
										onClick={() => setStep("select")}
									>
										Back
									</button>
									<button
										type="button"
										disabled={committing || message.trim().length === 0}
										onClick={() => {
											setCommitting(true)
											setCommitError(null)
											void controller
												?.onCommit({
													expectedComparisonIdentity: comparison.identity,
													message,
													paths: selectedPaths,
												})
												.then(() => {
													setCommitting(false)
													closeCommit()
													setMessage("")
												})
												.catch((error: unknown) => {
													setCommitting(false)
													setCommitError(
														error instanceof Error
															? error.message
															: String(error),
													)
												})
										}}
									>
										{committing ? "Committing…" : "Commit selected units"}
									</button>
								</commit-dialog-actions>
							</>
						)}
					</form>
				</dialog>
			)}
		</source-review-surface>
	)
}
