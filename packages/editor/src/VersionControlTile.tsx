import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"
import type { GlyphId } from "@create-font/states"
import { useEffect, useMemo, useState } from "preact/hooks"

import css from "./VersionControlTile.module.css"
import type {
	EditorVersionControl,
	VersionControlChangeUnit,
} from "./version-control.ts"

const svg = {
	Check: CheckIcon,
	Cross: Cross2Icon,
}

export interface VersionControlTileProps {
	readonly diffView: boolean
	readonly onDiffViewChange: (enabled: boolean) => void
	readonly onReviewGlyph: (glyphId: GlyphId) => void
	readonly versionControl?: EditorVersionControl
}

function count(
	changes: readonly VersionControlChangeUnit[],
	kind: VersionControlChangeUnit["change"],
): number {
	return changes.filter((change) => change.change === kind).length
}

export function VersionControlTile({
	diffView,
	onDiffViewChange,
	onReviewGlyph,
	versionControl,
}: VersionControlTileProps) {
	const comparison = versionControl?.comparison
	const changes = comparison?.changes ?? []
	const [baseRef, setBaseRef] = useState("HEAD")
	const [targetRef, setTargetRef] = useState("")
	const [commitOpen, setCommitOpen] = useState(false)
	const [step, setStep] = useState<"select" | "message">("select")
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
	const [message, setMessage] = useState("")
	const [commitError, setCommitError] = useState<string | null>(null)
	const [committing, setCommitting] = useState(false)
	const keys = useMemo(
		() => changes.map((change) => `${change.kind}:${change.id}`),
		[changes],
	)

	useEffect(() => {
		setSelected(
			(current) => new Set([...current].filter((key) => keys.includes(key))),
		)
	}, [keys.join("\0")])

	const openCommit = (): void => {
		setSelected(new Set(keys))
		setStep("select")
		setCommitError(null)
		setCommitOpen(true)
	}
	const selectedChanges = changes.filter((change) =>
		selected.has(`${change.kind}:${change.id}`),
	)
	const remaining = changes.length - selectedChanges.length

	return (
		<version-control-tile className={css.class}>
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
				<button
					type="button"
					disabled={versionControl === undefined || versionControl.loading}
					onClick={() =>
						void versionControl?.onCompare(
							baseRef.trim(),
							targetRef.trim() || undefined,
						)
					}
				>
					Compare
				</button>
			</comparison-controls>
			<comparison-status role="status" aria-live="polite">
				{versionControl === undefined
					? "Version control is unavailable in this editor session."
					: versionControl.loading
						? "Loading source changes…"
						: versionControl.error !== undefined
							? versionControl.error
							: comparison === undefined
								? "No comparison loaded."
								: `${comparison.base.label} → ${comparison.target.label}`}
			</comparison-status>
			<diff-view-toggle>
				<toggle-copy>
					<strong>Diff View</strong>
					<small>
						Compare the active glyph without changing the live source.
					</small>
				</toggle-copy>
				<button
					type="button"
					aria-pressed={diffView}
					disabled={comparison === undefined}
					onClick={() => onDiffViewChange(!diffView)}
				>
					{diffView ? "On" : "Off"}
				</button>
			</diff-view-toggle>
			{comparison === undefined ? null : (
				<>
					<change-counts aria-label={`${changes.length} source changes`}>
						<data value={changes.length}>{changes.length} total</data>
						<span>{count(changes, "added")} added</span>
						<span>{count(changes, "modified")} modified</span>
						<span>{count(changes, "deleted")} deleted</span>
					</change-counts>
					{changes.length === 0 ? (
						<empty-changes>
							<svg.Check aria-hidden="true" />
							<span>No source differences</span>
						</empty-changes>
					) : (
						<ul aria-label="Changed source units">
							{changes.map((change) => (
								<li
									key={`${change.kind}:${change.id}`}
									data-change={change.change}
								>
									<button
										type="button"
										disabled={change.kind !== "glyph"}
										onClick={() =>
											change.kind === "glyph"
												? onReviewGlyph(change.id as GlyphId)
												: undefined
										}
									>
										<i aria-hidden="true" />
										<span>{change.label}</span>
										<small>{change.change}</small>
									</button>
								</li>
							))}
						</ul>
					)}
					<button
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
				<dialog open aria-labelledby="commit-title">
					<form method="dialog" onSubmit={(event) => event.preventDefault()}>
						<commit-dialog-heading>
							<strong id="commit-title">
								{step === "select" ? "Select source units" : "Commit message"}
							</strong>
							<button
								type="button"
								aria-label="Close commit dialog"
								onClick={() => setCommitOpen(false)}
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
										const key = `${change.kind}:${change.id}`
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
									<button type="button" onClick={() => setCommitOpen(false)}>
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
										<li key={`${change.kind}:${change.id}`}>{change.label}</li>
									))}
								</ul>
								<label>
									<span>Commit message</span>
									<textarea
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
											void versionControl
												?.onCommit({
													expectedComparisonIdentity: comparison.identity,
													message,
													paths: selectedChanges.flatMap(
														(change) => change.paths,
													),
												})
												.then(() => {
													setCommitting(false)
													setCommitOpen(false)
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
		</version-control-tile>
	)
}
