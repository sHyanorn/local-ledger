import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * A modal dialog on the native <dialog> element: it traps focus, and
 * Escape closes it.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}

/** Asks before a change that cannot be undone, and says what it does. */
export function Confirm({
  title,
  message,
  action,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  /** The label of the button that goes ahead; omitted, the dialog only informs. */
  action?: string
  onConfirm?: () => void
  onCancel: () => void
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="actions">
        {action ? (
          <>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={onConfirm}
              autoFocus
            >
              {action}
            </button>
          </>
        ) : (
          <button type="button" onClick={onCancel} autoFocus>
            OK
          </button>
        )}
      </div>
    </Dialog>
  )
}
