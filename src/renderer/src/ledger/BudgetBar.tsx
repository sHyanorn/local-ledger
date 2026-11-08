/** The share of a budget spent, as a thin bar. */
export function BudgetBar({ share }: { share: number }) {
  return (
    <svg className="bar" aria-hidden="true" width="100%" height="6">
      <rect className="track" width="100%" height="6" rx="3" />
      <rect className="fill" width={`${share * 100}%`} height="6" rx="3" />
    </svg>
  )
}
