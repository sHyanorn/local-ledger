// The vault: vault.json and the current database generation, in one
// directory under the user data directory. Holds the open database while
// unlocked. Operations run one at a time; a lock takes effect at once and
// cancels the operations already called.
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
import { changeKey, DamagedError, openDatabase } from './database'
import type { Db } from './database'
import { noCheckpoint, syncDirectory, syncFile, writeFileAtomic } from './files'
import type { Checkpoint } from './files'
import { DEFAULT_KDF } from './kdf'
import type { Derive, KdfParams } from './kdf'
import { createKey, openKey } from './keys'
import type { NewKey } from './keys'
import { NewerSchemaError } from './migrations'
import { parseVaultFile, serializeVaultFile, VAULT_FILE } from './vault-file'
import type { VaultFile } from './vault-file'

export const VAULT_DIR = 'vault'
const STAGING_PREFIX = 'vault.creating-'
/** Files an interrupted change can leave behind. */
const LEFTOVER = /^(ledger-\d+\.db(\.tmp)?(-journal)?|vault\.json\.tmp)$/
/** Operations waiting or running at once; the page sends one at a time. */
const MAX_PENDING = 4

export const databaseName = (generation: number) => `ledger-${generation}.db`

export class LockedError extends Error {
  constructor() {
    super('the vault is locked')
  }
}

export class BusyError extends Error {
  constructor() {
    super('too many vault operations are waiting')
  }
}

type Listener = (state: VaultState) => void
/** True once a lock has come after the operation was called. */
type Cancelled = () => boolean

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
  #pending = 0
  #locks = 0
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
  create(password: string): Promise<Outcome<'exists' | 'locked'>> {
    return this.#run(async (cancelled) => {
      if (existsSync(this.dir)) return { ok: false, reason: 'exists' }
      const { file, dataKey } = await createKey(
        password,
        1,
        this.derive,
        this.kdf,
      )
      try {
        if (cancelled()) return { ok: false, reason: 'locked' }
        this.#removeStaging()
        const staging = mkdtempSync(join(this.root, STAGING_PREFIX))
        openDatabase(join(staging, databaseName(1)), dataKey, {
          create: true,
        }).close()
        if (
          !writeFileAtomic(join(staging, VAULT_FILE), serializeVaultFile(file))
        )
          throw new Error('the new vault could not be flushed')
        this.checkpoint('vault staged')
        renameSync(staging, this.dir)
        syncDirectory(this.root)
        const opened = this.#openWithKey(file, dataKey)
        if (!opened.ok)
          throw new Error(`the new vault did not open: ${opened.reason}`)
        return { ok: true }
      } finally {
        dataKey.fill(0)
      }
    })
  }

  unlock(
    password: string,
  ): Promise<
    Outcome<'wrong-password' | 'no-vault' | 'damaged' | 'newer' | 'locked'>
  > {
    return this.#run(async (cancelled) => {
      if (this.#db) return { ok: true }
      const state = this.state
      if (state === 'new') return { ok: false, reason: 'no-vault' }
      const file = this.#readFile()
      if (state === 'damaged' || !file) return { ok: false, reason: 'damaged' }
      const dataKey = await openKey(file, password, this.derive)
      if (!dataKey) return { ok: false, reason: 'wrong-password' }
      try {
        if (cancelled()) return { ok: false, reason: 'locked' }
        return this.#openWithKey(file, dataKey)
      } finally {
        dataKey.fill(0)
      }
    })
  }

  /**
   * Closes the database now, without waiting for queued operations, and
   * cancels those already called: each stops at its next step.
   */
  lock(): void {
    this.#locks++
    const db = this.#db
    if (!db && this.#pending === 0) return
    this.#db = null
    db?.close()
    this.#emit()
  }

  /**
   * Seals a new data key under the new password and re-encrypts a copy of
   * the database with it.
   */
  changePassword(
    current: string,
    next: string,
  ): Promise<Outcome<'wrong-password' | 'locked' | 'damaged'>> {
    return this.#run(async (cancelled) => {
      if (!this.#db) return { ok: false, reason: 'locked' }
      const file = this.#readFile()
      if (!file) return { ok: false, reason: 'damaged' }
      let oldKey: Buffer | null = null
      let created: NewKey | null = null
      try {
        oldKey = await openKey(file, current, this.derive)
        if (!oldKey) return { ok: false, reason: 'wrong-password' }
        created = await createKey(
          next,
          file.generation + 1,
          this.derive,
          this.kdf,
        )
        if (cancelled()) return { ok: false, reason: 'locked' }
        return this.#reencrypt(file, oldKey, created)
      } finally {
        oldKey?.fill(0)
        created?.dataKey.fill(0)
      }
    })
  }

  /**
   * Runs operations one at a time, in call order. Each learns whether a
   * lock has come since it was called.
   */
  #run<T>(operation: (cancelled: Cancelled) => Promise<T>): Promise<T> {
    if (this.#pending >= MAX_PENDING) return Promise.reject(new BusyError())
    const locks = this.#locks
    this.#pending++
    const result = this.#queue
      .then(() => operation(() => this.#locks !== locks))
      .finally(() => this.#pending--)
    this.#queue = result.catch(() => {})
    return result
  }

  /**
   * Copies the database, re-encrypts the copy under the new data key and
   * commits it by renaming the new vault.json over the old one. A crash
   * before that rename leaves the old password working, after it the new
   * one; the other generation is removed on the next successful open.
   */
  #reencrypt(
    file: VaultFile,
    oldKey: Buffer,
    created: NewKey,
  ): Outcome<'damaged'> {
    const currentPath = join(this.dir, databaseName(file.generation))
    const nextPath = join(this.dir, databaseName(created.file.generation))
    const temporary = `${nextPath}.tmp`
    this.#db?.close()
    this.#db = null
    try {
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
      const flushed = writeFileAtomic(
        join(this.dir, VAULT_FILE),
        serializeVaultFile(created.file),
        this.checkpoint,
      )
      this.checkpoint('committed')
      // Until the directory is flushed, a power cut could bring the old
      // vault.json back, so its generation stays until the next unlock.
      const opened = this.#openWithKey(created.file, created.dataKey, flushed)
      return opened.ok ? opened : { ok: false, reason: 'damaged' }
    } catch (error) {
      this.#reopenAfterFailure(file, oldKey, created)
      throw error
    } finally {
      if (!this.#db) this.#emit()
    }
  }

  /**
   * After a failed change, without a crash: reopens the generation that
   * vault.json on disk names, so whether the change committed is read from
   * the disk. Deletes nothing itself; when the change did not commit, that
   * open removes the new generation as a leftover. Stays locked if neither
   * opens.
   */
  #reopenAfterFailure(file: VaultFile, oldKey: Buffer, created: NewKey): void {
    if (this.#db) return
    try {
      const named = this.#readFile()?.generation
      if (named === file.generation) this.#openWithKey(file, oldKey)
      else if (named === created.file.generation)
        this.#openWithKey(created.file, created.dataKey, false)
    } catch {
      // Stays locked; the caller reports the original failure.
    }
  }

  #openWithKey(
    file: VaultFile,
    dataKey: Uint8Array,
    removeLeftovers = true,
  ): Outcome<'damaged' | 'newer'> {
    let db: Db
    try {
      db = openDatabase(join(this.dir, databaseName(file.generation)), dataKey)
    } catch (error) {
      if (error instanceof NewerSchemaError)
        return { ok: false, reason: 'newer' }
      if (error instanceof DamagedError) return { ok: false, reason: 'damaged' }
      throw error
    }
    this.#db = db
    if (removeLeftovers) this.#removeLeftovers(file.generation)
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
   * Removes what an interrupted change left behind, once the current
   * generation has opened and passed quick_check.
   */
  #removeLeftovers(current: number): void {
    const keep = new Set([
      VAULT_FILE,
      databaseName(current),
      `${databaseName(current)}-journal`,
    ])
    for (const name of readdirSync(this.dir)) {
      if (!LEFTOVER.test(name) || keep.has(name)) continue
      try {
        rmSync(join(this.dir, name), { force: true })
      } catch {
        // Held open by another program; the next unlock tries again.
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
