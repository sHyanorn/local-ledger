/** The × that closes a bar. */
export function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="icon"
      aria-label="Dismiss"
      title="Dismiss"
      onClick={onClick}
    >
      ×
    </button>
  )
}

/** A message in a bar the user can dismiss; nothing without a message. */
export function NoticeBar({
  label = 'Notice',
  message,
  onDismiss,
}: {
  label?: string
  message: string | null
  onDismiss: () => void
}) {
  if (!message) return null
  return (
    <div className="suggestion" role="region" aria-label={label}>
      <p>{message}</p>
      <DismissButton onClick={onDismiss} />
    </div>
  )
}
