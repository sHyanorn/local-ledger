/** A problem to report, read out when it appears; nothing without one. */
export function ErrorText({
  message,
  className,
}: {
  message: string | null | undefined
  className?: string
}) {
  if (!message) return null
  return (
    <p className={className ? `error ${className}` : 'error'} role="alert">
      {message}
    </p>
  )
}
