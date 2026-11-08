import type { Results, VaultState } from './ipc'
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
}
