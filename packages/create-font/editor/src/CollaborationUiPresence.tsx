import type { CSSProperties } from "react"

import type { EditorCollaborationSession } from "./browser-api.ts"
import {
	participantColor,
	participantInitials,
} from "./collaboration-presence.ts"
import css from "./CollaborationUiPresence.module.css"

export function CollaborationUiPresence({
	session,
}: {
	readonly session: EditorCollaborationSession
}) {
	const remote = session.presence.filter(
		(presence) =>
			presence.deviceId !== session.deviceId && presence.ui !== undefined,
	)
	return (
		<collaboration-ui-presence className={css.class} aria-hidden="true">
			{remote.flatMap((presence, presenceIndex) => {
				if (presence.ui === null) return []
				const participant = session.participants.find(
					(item) => item.identity.deviceId === presence.deviceId,
				)
				const name = participant?.identity.name ?? `Guest`
				const color = participantColor(presence.deviceId)
				const columns = presence.ui.columns.map((column, columnIndex) => (
					<remote-ui-column
						key={`${presence.deviceId}:${columnIndex}`}
						style={
							{
								"--presence-color": color,
								"--presence-inset": `${presenceIndex * 2}px`,
								left: `${column.minX * 100}%`,
								top: `${column.minY * 100}%`,
								width: `${(column.maxX - column.minX) * 100}%`,
								height: `${(column.maxY - column.minY) * 100}%`,
							} as CSSProperties
						}
					/>
				))
				const cursor = presence.ui.cursor
				const cursorColumn =
					cursor === null ? undefined : presence.ui.columns[cursor.column]
				return [
					...columns,
					...(cursor === null || cursorColumn === undefined
						? []
						: [
								<remote-ui-cursor
									key={`${presence.deviceId}:cursor`}
									style={
										{
											"--presence-color": color,
											left: `${(cursorColumn.minX + (cursorColumn.maxX - cursorColumn.minX) * cursor.x) * 100}%`,
											top: `${(cursorColumn.minY + (cursorColumn.maxY - cursorColumn.minY) * cursor.y) * 100}%`,
										} as CSSProperties
									}
								>
									<svg viewBox="0 0 14 20">
										<path d="M1 1v15l4-4 3.3 6 3-1.6-3.2-5.8H13L1 1Z" />
									</svg>
									<span>{name}</span>
									<i>{participantInitials(name)}</i>
								</remote-ui-cursor>,
							]),
				]
			})}
		</collaboration-ui-presence>
	)
}
