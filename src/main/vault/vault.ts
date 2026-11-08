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
import { errorCode } from '../error-code'
import { changeKey, DamagedError, openDatabase } from './database'
import type { Db } from './database'
import {
  flushDirectory,
  noCheckpoint,
  syncDirectory,
  syncFile,
  writeFileAtomic,
} from './files'
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
    this.name = 'LockedError'
  }
}

export class BusyError extends Error {
  constructor() {
    super('too many vault operations are waiting')
    this.name = 'BusyError'
  }
}

type Listener = (state: VaultState) => void
/** True once a lock has come after the operation was called. */
type Cancelled = () => boolean
interface OpenOptions {
  /** Remove other generations and temporary files. */
  removeLeftovers?: boolean
  /** Tell listeners, which replaces the page. */
  emit?: boolean
}

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
      if (cancelled()) return { ok: false, reason: 'locked' }
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
        // The vault is in place: nothing after this undoes it, and the page
        // shows it either way.
        try {
          flushDirectory(this.root)
          const opened = this.#openWithKey(file, dataKey)
          if (!opened.ok)
            throw new Error(`the new vault did not open: ${opened.reason}`)
        } finally {
          if (!this.#db) this.#emit()
        }
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
      if (cancelled()) return { ok: false, reason: 'locked' }
      if (this.#db) {
        // A page that still asks is out of date; replace it.
        this.#emit()
        return { ok: true }
      }
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
   * cancels those already called: each stops at its next step. Returns
   * whether anything was open or waiting, in which case listeners were told.
   */
  lock(): boolean {
    this.#locks++
    const db = this.#db
    if (!db && this.#pending === 0) return false
    try {
      db?.close()
    } finally {
      this.#db = null
      this.#emit()
    }
    return true
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
        if (cancelled()) return { ok: false, reason: 'locked' }
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
      writeFileAtomic(
        join(this.dir, VAULT_FILE),
        serializeVaultFile(created.file),
        this.checkpoint,
      )
      this.checkpoint('committed')
      // Other generations go only once a directory flush shows that
      // vault.json names this one.
      const opened = this.#openWithKey(created.file, created.dataKey)
      return opened.ok ? opened : { ok: false, reason: 'damaged' }
    } catch (error) {
      return this.#afterFailure(error, file, oldKey, created)
    } finally {
      if (!this.#db) this.#emit()
    }
  }

  /**
   * A step of a change failed without a crash. vault.json on disk tells
   * whether the change committed, and the generation it names is reopened;
   * nothing is deleted here. Before the commit, the old generation reopens
   * without replacing the page, which then reports the failure. After it,
   * the change stands.
   */
  #afterFailure(
    error: unknown,
    file: VaultFile,
    oldKey: Buffer,
    created: NewKey,
  ): Outcome<'damaged'> {
    const named = this.#readFile()?.generation
    if (named === created.file.generation) {
      console.error(
        `password change committed, then failed: ${errorCode(error)}`,
      )
      this.#tryOpen(created.file, created.dataKey, { removeLeftovers: false })
      return { ok: true }
    }
    if (named === file.generation) this.#tryOpen(file, oldKey, { emit: false })
    throw error
  }

  /** Opens the generation, staying locked if it does not open. */
  #tryOpen(file: VaultFile, dataKey: Uint8Array, options: OpenOptions): void {
    try {
      this.#openWithKey(file, dataKey, options)
    } catch {
      // Stays locked.
    }
  }

  #openWithKey(
    file: VaultFile,
    dataKey: Uint8Array,
    { removeLeftovers = true, emit = true }: OpenOptions = {},
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
    if (emit) this.#emit()
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
   * generation has opened and passed quick_check, and only after a
   * directory flush shows that vault.json names it on disk. Never throws:
   * whatever stays is tried again at the next unlock.
   */
  #removeLeftovers(current: number): void {
    const keep = new Set([
      VAULT_FILE,
      databaseName(current),
      `${databaseName(current)}-journal`,
    ])
    let names: string[]
    try {
      syncDirectory(this.dir)
      names = readdirSync(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      if (!LEFTOVER.test(name) || keep.has(name)) continue
      try {
        rmSync(join(this.dir, name), { force: true })
      } catch {
        // Held open by another program.
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

  /** A listener that fails does not undo a change that has happened. */
  #emit(): void {
    const state = this.state
    for (const listener of this.#listeners) {
      try {
        listener(state)
      } catch (error) {
        console.error(`vault listener failed: ${errorCode(error)}`)
      }
    }
  }
}
