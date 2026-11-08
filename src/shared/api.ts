import type { ImportTarget, Mapping, Encoding } from './imports'
import type { Results, VaultState } from './ipc'
import type { RuleFields, RuleMatch } from './rules'
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
}

export interface ImportRequest {
  id: string
  encoding: Encoding
  mapping: Mapping
  targets: ImportTarget[]
}
