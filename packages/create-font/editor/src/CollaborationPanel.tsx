import { type CSSProperties, useEffect, useState } from "react"

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
	followingDeviceId,
	onFollow,
}: {
	readonly collaboration: EditorCollaboration
	readonly followingDeviceId: string | null
	readonly onFollow: (deviceId: string) => void
}) {
	const session = useCollaborationSession(collaboration)
	const connected = session.participants.filter(
		(participant) => participant.connected,
	)
	const followedParticipant = session.participants.find(
		(participant) => participant.identity.deviceId === followingDeviceId,
	)

	return (
		<collaboration-panel className={css.class}>
			<details>
				<summary
					aria-label={`${connected.length} connected participant${connected.length === 1 ? `` : `s`}; your role is ${session.role}${followedParticipant === undefined ? `` : `; following ${followedParticipant.identity.name}`}`}
				>
					<participant-avatars>
						{connected.slice(0, 4).map((participant) => {
							const deviceId = participant.identity.deviceId
							const presence = session.presence.find(
								(item) => item.deviceId === deviceId,
							)
							const avatar = participantInitials(participant.identity.name)
							const title = `${participant.identity.name}${presence?.context.glyph === undefined || presence.context.glyph === null ? `` : ` · ${presence.context.glyph}`}`
							return deviceId === session.deviceId ? (
								<i
									key={deviceId}
									style={{
										background: participantColor(deviceId),
									}}
									title={`${title} · You`}
								>
									{avatar}
								</i>
							) : (
								<button
									key={deviceId}
									type="button"
									aria-label={
										followingDeviceId === deviceId
											? `Stop following ${participant.identity.name}`
											: `Follow ${participant.identity.name}`
									}
									aria-pressed={followingDeviceId === deviceId}
									data-following={followingDeviceId === deviceId}
									style={
										{
											"--participant-color": participantColor(deviceId),
											background: participantColor(deviceId),
										} as CSSProperties
									}
									title={`${followingDeviceId === deviceId ? `Stop following` : `Follow`} ${title}`}
									onClick={(event) => {
										event.preventDefault()
										event.stopPropagation()
										onFollow(deviceId)
									}}
								>
									{avatar}
								</button>
							)
						})}
						{connected.length <= 4 ? null : <b>+{connected.length - 4}</b>}
					</participant-avatars>
					<span>
						{followedParticipant === undefined
							? `${connected.length} · ${session.role}`
							: `Following ${followedParticipant.identity.name} · Esc to stop`}
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
								<participant-actions>
									{participant.connected &&
									participant.identity.deviceId !== session.deviceId ? (
										<button
											type="button"
											aria-pressed={
												followingDeviceId === participant.identity.deviceId
											}
											onClick={() => onFollow(participant.identity.deviceId)}
										>
											{followingDeviceId === participant.identity.deviceId
												? `Stop following`
												: `Follow`}
										</button>
									) : null}
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
								</participant-actions>
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
