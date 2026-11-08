// Transfers between the user's own accounts, as the page sees them.

/** Days apart the two sides of a transfer may be dated. */
export const TRANSFER_DAYS = 4

export interface TransferSide {
  id: number
  accountId: number
  date: string
  amountCents: number
  description: string
}

/** Two transactions that may be one transfer, not yet decided. */
export interface PossibleTransfer {
  out: TransferSide
  in: TransferSide
}
