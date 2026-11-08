import type { ImportTarget, Mapping, Encoding } from './imports'
import type { Results, VaultState } from './ipc'
import type { RuleFields, RuleMatch } from './rules'
import type { Command } from './commands'
import type { ExportFormat } from './export'
import type { Settings } from './settings'
import type { Currency } from './money'
import type {
  AccountFields,
  CategoryFields,
  TransactionCursor,
  TransactionFields,
  TransactionFilter,
} from './ledger'

type Updated<T> = T & { id: number }

/** The API that preload exposes to the renderer as `window.ledger`. */
export interface LedgerApi {
  readonly version: string
  readonly commands: {
    /** Calls back with each menu command; returns a function that stops. */
    on(listener: (command: Command) => void): () => void
  }
  readonly vault: {
    status(): Promise<VaultState>
    create(password: string): Promise<Results['vault:create']>
    unlock(password: string): Promise<Results['vault:unlock']>
    lock(): Promise<void>
    changePassword(
      current: string,
      next: string,
    ): Promise<Results['vault:change-password']>
  }
  readonly accounts: {
    list(): Promise<Results['accounts:list']>
    create(fields: AccountFields): Promise<Results['accounts:create']>
    update(fields: Updated<AccountFields>): Promise<Results['accounts:update']>
    delete(id: number): Promise<Results['accounts:delete']>
  }
  readonly categories: {
    list(): Promise<Results['categories:list']>
    create(fields: CategoryFields): Promise<Results['categories:create']>
    update(
      fields: Updated<CategoryFields>,
    ): Promise<Results['categories:update']>
    delete(id: number): Promise<Results['categories:delete']>
  }
  readonly transactions: {
    page(
      filter: TransactionFilter,
      limit: number,
      after?: TransactionCursor,
    ): Promise<Results['transactions:page']>
    totals(filter: TransactionFilter): Promise<Results['transactions:totals']>
    create(fields: TransactionFields): Promise<Results['transactions:create']>
    update(
      fields: Updated<TransactionFields>,
    ): Promise<Results['transactions:update']>
    /** Changes only the category, leaving the rest as stored. */
    setCategory(
      id: number,
      categoryId: number | null,
    ): Promise<Results['transactions:set-category']>
    delete(id: number): Promise<Results['transactions:delete']>
  }
  readonly imports: {
    /** Asks the user for a CSV file and reads it; the file waits in the main process. */
    open(): Promise<Results['import:open']>
    /** Reads a file dropped on the window, as open reads a chosen one. */
    drop(
      name: string,
      bytes: Uint8Array<ArrayBuffer>,
    ): Promise<Results['import:drop']>
    preview(request: ImportRequest): Promise<Results['import:preview']>
    /** Imports the rows whose indexes are selected. */
    commit(
      request: ImportRequest,
      selected: number[],
    ): Promise<Results['import:commit']>
    discard(id: string): Promise<void>
    batches(): Promise<Results['import:batches']>
    /** Removes an import's transactions, edited or not. */
    undo(batchId: number): Promise<Results['import:undo']>
  }
  readonly rules: {
    list(): Promise<Results['rules:list']>
    /** With `apply`, also categorizes the uncategorized transactions it matches first. */
    create(
      fields: RuleFields & { apply: boolean },
    ): Promise<Results['rules:create']>
    update(fields: Updated<RuleFields>): Promise<Results['rules:update']>
    delete(id: number): Promise<Results['rules:delete']>
    /** One place earlier (-1) or later (1). */
    move(id: number, offset: -1 | 1): Promise<Results['rules:move']>
    reach(rule: {
      pattern: string
      match: RuleMatch
      id?: number
    }): Promise<Results['rules:reach']>
    /** A rule to offer after the user set this transaction's category. */
    suggest(transactionId: number): Promise<Results['rules:suggest']>
    /** Stops suggesting rules for this payee. */
    decline(pattern: string): Promise<void>
  }
  readonly budgets: {
    /** Each category's budget in effect and its spending in the month (YYYY-MM). */
    month(month: string): Promise<Results['budgets:month']>
    /** Sets a category's budget from the month on; null ends it from then. */
    set(
      categoryId: number,
      month: string,
      amountCents: number | null,
    ): Promise<Results['budgets:set']>
  }
  readonly reports: {
    /** The month's income, spending and categories, and the twelve months to it. */
    month(month: string, currency: Currency): Promise<Results['reports:month']>
    /** A category's spending in each of the twelve months to this one. */
    trend(
      categoryId: number,
      month: string,
      currency: Currency,
    ): Promise<Results['reports:trend']>
  }
  readonly backup: {
    /**
     * Seals a backup under the master password, which must be the current
     * one, and asks where to save it.
     */
    save(password: string): Promise<Results['backup:save']>
  }
  readonly restore: {
    /** Asks for a backup file and keeps it in the main process. */
    open(): Promise<Results['restore:open']>
    /** Opens the chosen backup with its password and says what it holds. */
    check(password: string): Promise<Results['restore:check']>
    /**
     * Puts the checked backup in place of the vault, which is moved aside.
     * From an open vault, with its current password, which the restored
     * vault keeps; at setup, with null, and the backup's password applies.
     */
    commit(currentPassword: string | null): Promise<Results['restore:commit']>
    discard(): Promise<void>
  }
  readonly settings: {
    get(): Promise<Results['settings:get']>
    /** Stores the given settings and returns them all. */
    update(changes: Partial<Settings>): Promise<Results['settings:update']>
  }
  readonly export: {
    /**
     * Asks where to save the month's statement in one currency, then writes
     * it there, unencrypted.
     */
    save(
      month: string,
      currency: Currency,
      format: ExportFormat,
    ): Promise<Results['export:save']>
  }
  readonly transfers: {
    /** Pairs that may be one transfer but have other candidates. */
    possible(): Promise<Results['transfers:possible']>
    count(): Promise<Results['transfers:count']>
    /** Transactions this one could be paired with by hand. */
    choices(transactionId: number): Promise<Results['transfers:choices']>
    link(
      transactionId: number,
      otherId: number,
    ): Promise<Results['transfers:link']>
    /** Splits a transfer; the two are not offered as a pair again. */
    unlink(transactionId: number): Promise<Results['transfers:unlink']>
    /** Records that two transactions are not a transfer. */
    reject(outId: number, inId: number): Promise<Results['transfers:reject']>
  }
}

export interface ImportRequest {
  id: string
  encoding: Encoding
  mapping: Mapping
  targets: ImportTarget[]
}
