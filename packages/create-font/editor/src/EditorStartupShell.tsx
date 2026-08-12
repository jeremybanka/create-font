import { MagnifyingGlassIcon } from "@radix-ui/react-icons"

import css from "./EditorStartupShell.module.css"
import type { EditorStartupState } from "./browser-api.ts"
import { MOD_KEY_LABEL } from "./editor-tools-and-hotkeys.ts"

const svg = {
	MagnifyingGlass: MagnifyingGlassIcon,
}

export interface EditorStartupShellProps {
	readonly state: EditorStartupState
}

export function EditorStartupShell({ state }: EditorStartupShellProps) {
	const loading = state.type === `loading`
	return (
		<editor-startup-shell className={css.class}>
			<app-shell
				aria-busy={loading ? `true` : `false`}
				data-startup-state={state.type}
			>
				<header>
					<brand-lockup>
						<brand-mark aria-hidden="true">
							<i />
							<i />
							<i />
						</brand-mark>
						<project-name>
							<strong>create-font</strong>
							<span>Opening font…</span>
						</project-name>
					</brand-lockup>
					<command-center>
						<button type="button" disabled aria-label="Commands unavailable">
							<svg.MagnifyingGlass aria-hidden="true" />
							<strong>Commands</strong>
							<kbd>{MOD_KEY_LABEL}+Shift+P</kbd>
						</button>
					</command-center>
					<header-actions>
						<document-status data-state={state.type}>
							<i />
							<span>{loading ? `Opening source` : `Source unavailable`}</span>
						</document-status>
						<view-tabs aria-label="Application views">
							<button type="button" disabled data-current="true">
								Canvas
							</button>
							<button type="button" disabled>
								Glyphs
							</button>
							<button type="button" disabled>
								Font Info
							</button>
						</view-tabs>
					</header-actions>
				</header>
				<main data-view="canvas">
					<editor-workspace>
						<startup-workbench aria-hidden="true">
							<startup-canvas />
							<startup-inspector />
							<startup-hotbar>
								{Array.from({ length: 9 }, (_, index) => (
									<i key={index} />
								))}
							</startup-hotbar>
						</startup-workbench>
						<source-startup-card
							role={loading ? `status` : `alert`}
							aria-live={loading ? `polite` : `assertive`}
							aria-atomic="true"
						>
							<p>
								{loading
									? `Opening your font workspace`
									: `Font source unavailable`}
							</p>
							<h1>
								{loading
									? `Preparing editable outlines…`
									: `We could not open this project.`}
							</h1>
							<span>
								{loading
									? `The editor will be ready when the source is connected and validated.`
									: state.message}
							</span>
							{loading ? (
								<loading-meter aria-hidden="true">
									<i />
								</loading-meter>
							) : (
								<startup-actions>
									<button type="button" onClick={state.onRetry}>
										Try again
									</button>
									<small>
										If the problem continues, check the create-font process in
										your terminal.
									</small>
								</startup-actions>
							)}
						</source-startup-card>
					</editor-workspace>
				</main>
				<footer>
					<active-context>
						<strong>{loading ? `Opening source` : `Source unavailable`}</strong>
						<span>—</span>
					</active-context>
					<keyboard-help>
						Editing controls become available after the font opens
					</keyboard-help>
					<format-label>create-font editor</format-label>
				</footer>
			</app-shell>
		</editor-startup-shell>
	)
}
