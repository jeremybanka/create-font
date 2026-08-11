import { type CSSProperties, useEffect, useState } from "react"

import type {
	EditorCollaboration,
	EditorCollaborationSession,
} from "./browser-api.ts"
import css from "./CollaborationPresenceLayer.module.css"

function participantColor(deviceId: string): string {
	let hash = 0
	for (const character of deviceId) {
		hash = (hash * 31 + character.codePointAt(0)!) >>> 0
	}
	return `hsl(${hash % 360} 58% 46%)`
}

export function CollaborationPresenceLayer({
	collaboration,
}: {
	readonly collaboration: EditorCollaboration
}) {
	const [session, setSession] = useState<EditorCollaborationSession>(
		collaboration.session,
	)
	useEffect(() => collaboration.subscribeSession(setSession), [collaboration])
	return (
		<collaboration-presence-layer className={css.class} aria-hidden="true">
			{session.presence.flatMap((presence) => {
				if (
					presence.deviceId === session.deviceId ||
					presence.cursor === null
				) {
					return []
				}
				const participant = session.participants.find(
					(item) => item.identity.deviceId === presence.deviceId,
				)
				return [
					<collaboration-cursor
						key={presence.deviceId}
						style={
							{
								"--participant-color": participantColor(presence.deviceId),
								left: presence.cursor.x,
								top: presence.cursor.y,
							} as CSSProperties
						}
					>
						<i />
						<span>{participant?.identity.name ?? `Guest`}</span>
					</collaboration-cursor>,
				]
			})}
		</collaboration-presence-layer>
	)
}
