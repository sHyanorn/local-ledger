import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * A modal dialog on the native <dialog> element: it traps focus, Escape
 * closes it, and on closing focus goes back to where it was.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  /** Read out with the title; makes it an alert dialog. */
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    // Focuses the first control in the dialog.
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      role={description ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {description && <p id={descriptionId}>{description}</p>}
      {children}
    </dialog>
  )
}

/**
 * Asks before a change that cannot be undone, and says what it does.
 * Cancel comes first, so it has the focus.
 */
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
    <Dialog title={title} description={message} onClose={onCancel}>
      <div className="actions">
        {action ? (
          <>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={onConfirm}>
              {action}
            </button>
          </>
        ) : (
          <button type="button" onClick={onCancel}>
            OK
          </button>
        )}
      </div>
    </Dialog>
  )
}
