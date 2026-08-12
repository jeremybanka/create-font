import { useEffect, useState } from "react"

import type {
	EditorCollaboration,
	EditorCollaborationSession,
} from "./browser-api.ts"
import {
	participantColor,
	participantInitials,
} from "./collaboration-presence.ts"
import css from "./CollaborationPanel.module.css"

function useCollaborationSession(
	collaboration: EditorCollaboration,
): EditorCollaborationSession {
	const [session, setSession] = useState<EditorCollaborationSession>(
		collaboration.session,
	)
	useEffect(() => collaboration.subscribeSession(setSession), [collaboration])
	return session
}

function timeLabel(value: number | null, connected: boolean): string {
	if (value === null) return connected ? `Online` : `Offline`
	const time = new Date(value).toLocaleTimeString([], {
		hour: `2-digit`,
		minute: `2-digit`,
	})
	return connected ? `Online since ${time}` : `Offline · last connected ${time}`
}

export function CollaborationPanel({
	collaboration,
}: {
	readonly collaboration: EditorCollaboration
}) {
	const session = useCollaborationSession(collaboration)
	const connected = session.participants.filter(
		(participant) => participant.connected,
	)

	return (
		<collaboration-panel className={css.class}>
			<details>
				<summary
					aria-label={`${connected.length} connected participant${connected.length === 1 ? `` : `s`}; your role is ${session.role}`}
				>
					<participant-avatars aria-hidden="true">
						{connected.slice(0, 4).map((participant) => {
							const presence = session.presence.find(
								(item) => item.deviceId === participant.identity.deviceId,
							)
							return (
								<i
									key={participant.identity.deviceId}
									style={{
										background: participantColor(participant.identity.deviceId),
									}}
									title={`${participant.identity.name}${presence?.context.glyph === undefined || presence.context.glyph === null ? `` : ` · ${presence.context.glyph}`}`}
								>
									{participantInitials(participant.identity.name)}
								</i>
							)
						})}
						{connected.length <= 4 ? null : <b>+{connected.length - 4}</b>}
					</participant-avatars>
					<span>
						{connected.length} · {session.role}
					</span>
				</summary>
				<collaboration-popover aria-label="Collaboration participants">
					<collaboration-header>
						<strong>On this font</strong>
						<span role="status" aria-live="polite">
							{connected.length} connected
						</span>
					</collaboration-header>
					<p role="status" aria-live="polite" data-status={session.status}>
						{session.status === `saving`
							? `Saving through host…`
							: session.status === `reconnecting`
								? `Reconnecting to host…`
								: session.status === `error`
									? `Not saved: ${session.error ?? `the host rejected the edit`}`
									: `All confirmed edits are saved by the host.`}
					</p>
					{session.role === `viewer` ? (
						<p role="note">
							You can explore this workspace, but only editors can change it.
						</p>
					) : null}
					<ul aria-label="Participants">
						{session.participants.map((participant) => (
							<li key={participant.identity.deviceId}>
								<i
									data-connected={participant.connected}
									style={{
										background: participantColor(participant.identity.deviceId),
									}}
									aria-hidden="true"
								/>
								<span>
									<strong>{participant.identity.name}</strong>
									<small>
										{participant.identity.email} · {participant.role}
									</small>
									<small>
										Device {participant.identity.deviceId.slice(0, 12)} ·{` `}
										{timeLabel(participant.connectedAt, participant.connected)}
									</small>
									{(() => {
										const presence = session.presence.find(
											(item) => item.deviceId === participant.identity.deviceId,
										)
										return presence === undefined ? null : (
											<small>
												{presence.context.glyph ?? `No glyph`} ·{" "}
												{presence.context.master ?? `No master`} ·{" "}
												{presence.gesture ?? `idle`} ·{" "}
												{presence.selection.length} selected
											</small>
										)
									})()}
								</span>
								{session.role === `owner` && participant.role !== `owner` ? (
									<button
										type="button"
										onClick={() =>
											void collaboration.revoke(participant.identity.deviceId)
										}
									>
										Revoke
									</button>
								) : null}
							</li>
						))}
					</ul>
					{session.role === `owner` && session.pending.length > 0 ? (
						<section aria-labelledby="admission-heading">
							<h2 id="admission-heading">Waiting for admission</h2>
							{session.pending.map((request) => (
								<article key={request.id}>
									<span>
										<strong>{request.identity.name}</strong>
										<small>{request.identity.email}</small>
										<small>
											Device {request.identity.deviceId.slice(0, 12)} ·
											requested{` `}
											{new Date(request.requestedAt).toLocaleTimeString([], {
												hour: `2-digit`,
												minute: `2-digit`,
											})}
										</small>
									</span>
									<button
										type="button"
										onClick={() =>
											void collaboration.decide(request.id, `approve`, `editor`)
										}
									>
										Allow editing
									</button>
									<button
										type="button"
										onClick={() =>
											void collaboration.decide(request.id, `approve`, `viewer`)
										}
									>
										View only
									</button>
									<button
										type="button"
										onClick={() =>
											void collaboration.decide(request.id, `reject`)
										}
									>
										Reject
									</button>
								</article>
							))}
						</section>
					) : null}
				</collaboration-popover>
			</details>
		</collaboration-panel>
	)
}
