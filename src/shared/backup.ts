// Backups as the page sees them.

/** What a checked backup holds, for the user to confirm before restoring it. */
export interface BackupSummary {
  accounts: number
  transactions: number
  /** The latest transaction's date, or null without any. */
  lastDate: string | null
}
