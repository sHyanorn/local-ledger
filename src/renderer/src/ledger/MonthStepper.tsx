import { formatMonth, shiftMonth } from './format'

/** The month shown, with buttons to the one before and after. */
export function MonthStepper({
  month,
  onChange,
}: {
  month: string
  onChange: (month: string) => void
}) {
  return (
    <>
      <button
        type="button"
        className="icon"
        aria-label="Previous Month"
        title="Previous Month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        ‹
      </button>
      <span aria-live="polite">{formatMonth(month)}</span>
      <button
        type="button"
        className="icon"
        aria-label="Next Month"
        title="Next Month"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
      </button>
    </>
  )
}
