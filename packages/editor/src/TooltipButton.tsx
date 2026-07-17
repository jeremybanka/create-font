import {
	autoUpdate,
	computePosition,
	flip,
	offset,
	shift,
	type Placement,
} from "@floating-ui/dom"
import type { JSX, Ref } from "preact"
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "preact/hooks"

import {
	ariaKeyShortcut,
	formatHotkey,
	type Hotkey,
} from "./editor-tools-and-hotkeys.ts"
import css from "./TooltipButton.module.css"
import {
	INITIAL_TOOLTIP_INTENT,
	nextTooltipIntent,
	tooltipWantsToOpen,
	type TooltipIntentEvent,
} from "./tooltip-interaction.ts"

const TOOLTIP_OPEN_DELAY = 480

type TooltipButtonProps = Omit<
	JSX.ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-label" | "disabled" | "title"
> &
	Readonly<{
		buttonRef?: Ref<HTMLButtonElement>
		description: string
		disabled?: boolean
		hotkey?: Hotkey
		label: string
		placement?: Placement
	}>

function assignRef(
	ref: Ref<HTMLButtonElement> | undefined,
	value: HTMLButtonElement | null,
): void {
	if (typeof ref === "function") ref(value)
	else if (ref !== null && ref !== undefined) ref.current = value
}

export function TooltipButton({
	buttonRef,
	children,
	description,
	disabled = false,
	hotkey,
	label,
	onBlur,
	onClick,
	onFocus,
	onKeyDown,
	placement = "right",
	...buttonProps
}: TooltipButtonProps) {
	const id = `tooltip-${useId().replaceAll(`:`, ``)}`
	const triggerRef = useRef<HTMLButtonElement>(null)
	const tooltipRef = useRef<HTMLElement>(null)
	const [intent, setIntent] = useState(INITIAL_TOOLTIP_INTENT)
	const [visible, setVisible] = useState(false)
	const [position, setPosition] = useState<
		Readonly<{ left: number; top: number }> | undefined
	>()
	const keycaps = hotkey === undefined ? [] : formatHotkey(hotkey)
	const wantsToOpen = tooltipWantsToOpen(intent, disabled)
	const dispatch = (event: TooltipIntentEvent): void => {
		setIntent((current) => nextTooltipIntent(current, event))
	}

	useEffect(() => {
		if (!disabled) return
		dispatch("disable")
		setVisible(false)
	}, [disabled])

	useEffect(() => {
		if (!wantsToOpen) {
			setVisible(false)
			setPosition(undefined)
			return
		}
		if (visible) return
		const timeout = window.setTimeout(
			() => setVisible(true),
			TOOLTIP_OPEN_DELAY,
		)
		return () => window.clearTimeout(timeout)
	}, [visible, wantsToOpen])

	useLayoutEffect(() => {
		const trigger = triggerRef.current
		const tooltip = tooltipRef.current
		if (!visible || trigger === null || tooltip === null) return
		try {
			tooltip.showPopover()
		} catch {
			// A browser may already have promoted this manually managed popover.
		}
		const update = (): void => {
			void computePosition(trigger, tooltip, {
				middleware: [offset(9), flip({ padding: 8 }), shift({ padding: 8 })],
				placement,
				strategy: "fixed",
			}).then(({ x, y }) => setPosition({ left: x, top: y }))
		}
		const stopUpdating = autoUpdate(trigger, tooltip, update)
		return () => {
			stopUpdating()
			try {
				tooltip.hidePopover()
			} catch {
				// Removing a popover from the document also closes it.
			}
		}
	}, [placement, visible])

	return (
		<tooltip-button
			className={css.class}
			onPointerEnter={() => dispatch("pointer-enter")}
			onPointerLeave={() => dispatch("pointer-leave")}
		>
			<button
				{...buttonProps}
				ref={(node) => {
					triggerRef.current = node
					assignRef(buttonRef, node)
				}}
				type={buttonProps.type ?? "button"}
				aria-label={label}
				aria-describedby={visible ? id : buttonProps["aria-describedby"]}
				aria-keyshortcuts={
					hotkey === undefined
						? buttonProps["aria-keyshortcuts"]
						: ariaKeyShortcut(hotkey)
				}
				disabled={disabled}
				onFocus={(event) => {
					dispatch("focus")
					onFocus?.(event)
				}}
				onBlur={(event) => {
					dispatch("blur")
					onBlur?.(event)
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						dispatch("escape")
						setVisible(false)
						event.stopPropagation()
						return
					}
					onKeyDown?.(event)
				}}
				onClick={(event) => {
					dispatch("activate")
					setVisible(false)
					onClick?.(event)
				}}
			>
				{children}
			</button>
			{visible ? (
				<tooltip-popover
					ref={tooltipRef}
					id={id}
					role="tooltip"
					popover="manual"
					data-positioned={position === undefined ? "false" : "true"}
					style={position}
				>
					<strong aria-hidden="true">{label}</strong>
					<span>{description}</span>
					{keycaps.length === 0 ? null : (
						<shortcut-keycaps aria-hidden="true">
							{keycaps.map((keycap) => (
								<kbd key={keycap}>{keycap}</kbd>
							))}
						</shortcut-keycaps>
					)}
				</tooltip-popover>
			) : null}
		</tooltip-button>
	)
}
