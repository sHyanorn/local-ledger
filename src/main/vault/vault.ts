// The vault: vault.json and the current database generation, in one
// directory under the user data directory. Holds the open database while
// unlocked; locking closes it. Operations run one at a time.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Outcome, VaultState } from '../../shared/ipc'
import { changeKey, openDatabase, WrongKeyError } from './database'
import type { Db } from './database'
import { noCheckpoint, syncDirectory, syncFile, writeFileAtomic } from './files'
import type { Checkpoint } from './files'
import { DEFAULT_KDF } from './kdf'
import type { Derive, KdfParams } from './kdf'
import { createKey, openKey } from './keys'
import { NewerSchemaError } from './migrations'
import { parseVaultFile, serializeVaultFile, VAULT_FILE } from './vault-file'
import type { VaultFile } from './vault-file'

export const VAULT_DIR = 'vault'
const STAGING_PREFIX = 'vault.creating-'

export const databaseName = (generation: number) => `ledger-${generation}.db`

export class LockedError extends Error {
  constructor() {
    super('the vault is locked')
  }
}

type Listener = (state: VaultState) => void

export interface VaultOptions {
  /** The key derivation; the app runs it in a worker. */
  derive: Derive
  /** Settings for new keys; tests lower them to run faster. */
  kdf?: KdfParams
  /** Lets tests interrupt multi-file changes. */
  checkpoint?: Checkpoint
}

export class Vault {
  readonly root: string
  readonly dir: string
  readonly derive: Derive
  readonly kdf: KdfParams
  readonly checkpoint: Checkpoint
  #db: Db | null = null
  #queue: Promise<unknown> = Promise.resolve()
  #listeners = new Set<Listener>()

  /** @param root the user data directory; the vault lives in its `vault` folder */
  constructor(
    root: string,
    { derive, kdf = DEFAULT_KDF, checkpoint = noCheckpoint }: VaultOptions,
  ) {
    this.root = root
    this.dir = join(root, VAULT_DIR)
    this.derive = derive
    this.kdf = kdf
    this.checkpoint = checkpoint
  }

  get unlocked(): boolean {
    return this.#db !== null
  }

  get state(): VaultState {
    if (this.#db) return 'unlocked'
    if (!existsSync(this.dir)) return 'new'
    const file = this.#readFile()
    if (!file || !existsSync(join(this.dir, databaseName(file.generation))))
      return 'damaged'
    return 'locked'
  }

  onChange(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** The open database; throws LockedError while locked. */
  database(): Db {
    if (!this.#db) throw new LockedError()
    return this.#db
  }

  /**
   * Builds the vault in a staging directory and renames it into place, so a
   * crash leaves either no vault or a whole one.
   */
  create(password: string): Promise<Outcome<'exists'>> {
    return this.#run(async () => {
      if (existsSync(this.dir)) return { ok: false, reason: 'exists' }
      this.#removeStaging()
      const staging = mkdtempSync(join(this.root, STAGING_PREFIX))
      const { file, dataKey } = await createKey(
        password,
        1,
        this.derive,
        this.kdf,
      )
      try {
        openDatabase(join(staging, databaseName(1)), dataKey, {
          create: true,
        }).close()
        writeFileAtomic(join(staging, VAULT_FILE), serializeVaultFile(file))
        this.checkpoint('vault staged')
        renameSync(staging, this.dir)
        syncDirectory(this.root)
        const opened = this.#openWithKey(file, dataKey)
        if (!opened.ok)
          throw new Error(`new vault did not open: ${opened.reason}`)
        return { ok: true }
      } finally {
        dataKey.fill(0)
      }
    })
  }

  unlock(
    password: string,
  ): Promise<Outcome<'wrong-password' | 'no-vault' | 'damaged' | 'newer'>> {
    return this.#run(async () => {
      if (this.#db) return { ok: true }
      const state = this.state
      if (state === 'new') return { ok: false, reason: 'no-vault' }
      const file = this.#readFile()
      if (state === 'damaged' || !file) return { ok: false, reason: 'damaged' }
      return this.#open(file, password)
    })
  }

  lock(): Promise<void> {
    return this.#run(async () => {
      if (!this.#db) return
      this.#db.close()
      this.#db = null
      this.#emit()
    })
  }

  /**
   * Seals a new data key under the new password and re-encrypts the
   * database with it, on a copy. Replacing vault.json is the single commit
   * point: a crash before it leaves the old password working, after it the
   * new one; the other generation is removed on the next successful open.
   */
  changePassword(
    current: string,
    next: string,
  ): Promise<Outcome<'wrong-password' | 'locked' | 'damaged'>> {
    return this.#run(async () => {
      const db = this.#db
      if (!db) return { ok: false, reason: 'locked' }
      const file = this.#readFile()
      if (!file) return { ok: false, reason: 'damaged' }
      const oldKey = await openKey(file, current, this.derive)
      if (!oldKey) return { ok: false, reason: 'wrong-password' }
      const generation = file.generation + 1
      const created = await createKey(next, generation, this.derive, this.kdf)
      const currentPath = join(this.dir, databaseName(file.generation))
      const nextPath = join(this.dir, databaseName(generation))
      const temporary = `${nextPath}.tmp`
      let committed = false
      try {
        db.close()
        this.#db = null
        rmSync(temporary, { force: true })
        copyFileSync(currentPath, temporary)
        this.checkpoint('copied')
        const copy = openDatabase(temporary, oldKey)
        try {
          changeKey(copy, created.dataKey)
          if (copy.pragma('integrity_check', { simple: true }) !== 'ok') {
            throw new Error('the re-encrypted copy failed integrity_check')
          }
        } finally {
          copy.close()
        }
        syncFile(temporary)
        this.checkpoint('re-encrypted')
        renameSync(temporary, nextPath)
        syncDirectory(this.dir)
        this.checkpoint('renamed')
        writeFileAtomic(
          join(this.dir, VAULT_FILE),
          serializeVaultFile(created.file),
          this.checkpoint,
        )
        committed = true
        this.checkpoint('committed')
        const opened = this.#openWithKey(created.file, created.dataKey)
        return opened.ok ? opened : { ok: false, reason: 'damaged' }
      } catch (error) {
        // Not a crash: put the vault back as it was, or as committed.
        if (!committed) {
          rmSync(temporary, { force: true })
          rmSync(nextPath, { force: true })
          this.#openWithKey(file, oldKey)
        } else {
          this.#openWithKey(created.file, created.dataKey)
        }
        throw error
      } finally {
        oldKey.fill(0)
        created.dataKey.fill(0)
      }
    })
  }

  /** Runs operations one at a time, in call order. */
  #run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation)
    this.#queue = result.catch(() => {})
    return result
  }

  async #open(
    file: VaultFile,
    password: string,
  ): Promise<Outcome<'wrong-password' | 'damaged' | 'newer'>> {
    const dataKey = await openKey(file, password, this.derive)
    if (!dataKey) return { ok: false, reason: 'wrong-password' }
    try {
      return this.#openWithKey(file, dataKey)
    } finally {
      dataKey.fill(0)
    }
  }

  #openWithKey(
    file: VaultFile,
    dataKey: Uint8Array,
  ): Outcome<'damaged' | 'newer'> {
    let db: Db
    try {
      db = openDatabase(join(this.dir, databaseName(file.generation)), dataKey)
    } catch (error) {
      if (error instanceof NewerSchemaError)
        return { ok: false, reason: 'newer' }
      if (error instanceof WrongKeyError)
        return { ok: false, reason: 'damaged' }
      throw error
    }
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      db.close()
      return { ok: false, reason: 'damaged' }
    }
    this.#db = db
    this.#removeLeftovers(file.generation)
    this.#emit()
    return { ok: true }
  }

  #readFile(): VaultFile | null {
    try {
      return parseVaultFile(readFileSync(join(this.dir, VAULT_FILE), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * Removes what an interrupted change left behind. Runs only once the
   * current generation has opened and passed quick_check.
   */
  #removeLeftovers(current: number): void {
    const keep = new Set([
      VAULT_FILE,
      databaseName(current),
      `${databaseName(current)}-journal`,
    ])
    for (const name of readdirSync(this.dir)) {
      const ours = /^(ledger-\d+\.db(\.tmp)?(-journal)?|vault\.json\.tmp)$/
      if (ours.test(name) && !keep.has(name)) {
        rmSync(join(this.dir, name), { force: true })
      }
    }
  }

  /** Staging directories were never the vault, so they are always safe to remove. */
  #removeStaging(): void {
    mkdirSync(this.root, { recursive: true })
    for (const name of readdirSync(this.root)) {
      if (name.startsWith(STAGING_PREFIX)) {
        rmSync(join(this.root, name), { recursive: true, force: true })
      }
    }
  }

  #emit(): void {
    const state = this.state
    for (const listener of this.#listeners) listener(state)
  }
}
