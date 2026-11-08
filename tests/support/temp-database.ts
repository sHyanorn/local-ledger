// A throwaway encrypted ledger database for tests of the data layer.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type Db } from '../../src/main/vault/database'

export interface TempDatabase {
  db: Db
  /** Closes the database and removes its directory. */
  dispose: () => void
}

/** A new database under a fixed fake key, in a directory of its own. */
export function tempDatabase(prefix: string): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const db = openDatabase(join(dir, 'ledger.db'), Buffer.alloc(32, 7), {
    create: true,
  })
  return {
    db,
    dispose: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
