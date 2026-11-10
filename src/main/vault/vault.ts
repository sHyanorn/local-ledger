// The vault: vault.json and the current database generation, in one
// directory under the user data directory. Holds the open database while
// unlocked. Operations run one at a time; a lock takes effect at once and
// cancels the operations already called.
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Outcome, VaultState } from '../../shared/ipc'
import { errorCode } from '../error-code'
import {
  changeKey,
  openDatabase,
  openFailure,
  passesIntegrityCheck,
} from './database'
import type { Db } from './database'
import {
  flushDirectory,
  noCheckpoint,
  syncDirectory,
  syncFile,
  writeFileAtomic,
} from './files'
import type { Checkpoint } from './files'
import { openBackupKey, readBackup, writeBackup } from './backup'
import { open } from './envelope'
import { DEFAULT_KDF, encodePassword } from './kdf'
import type { Derive, KdfParams } from './kdf'
import { createKey, openKey, sealDataKey } from './keys'
import type { NewKey } from './keys'
import {
  databaseName,
  recoverStaged,
  removeRestoring,
  removeStaging,
  replacedName,
  STAGING_PREFIX,
  VAULT_DIR,
} from './layout'
import { stageBackup, type StagedBackup } from './stage-backup'
import {
  associatedData,
  readVaultFile,
  serializeVaultFile,
  VAULT_FILE,
} from './vault-file'
import type { Check, VaultFile } from './vault-file'

/** Files an interrupted change can leave behind. */
const LEFTOVER =
  /^(ledger-\d+\.db(\.tmp|\.before-migration)?(-journal)?|vault\.json\.tmp)$/
/** Operations waiting or running at once; the page sends one at a time. */
const MAX_PENDING = 4

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
  /** Connections whose close failed because a statement was still running. */
  #unclosed = new Set<Db>()

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
    recoverStaged(root, this.dir)
    removeRestoring(root)
  }

  get unlocked(): boolean {
    return this.#db !== null
  }

  get state(): VaultState {
    if (this.#db) return 'unlocked'
    if (!existsSync(this.dir)) return 'new'
    const file = this.#readFile()?.file
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
        removeStaging(this.root)
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
      const read = this.#readFile()
      if (state === 'damaged' || !read) return { ok: false, reason: 'damaged' }
      const { file, check } = read
      const dataKey = await openKey(file, password, this.derive)
      if (!dataKey) return { ok: false, reason: unsealFailure(check) }
      try {
        if (cancelled()) return { ok: false, reason: 'locked' }
        const opened = this.#openWithKey(file, dataKey)
        // The key unsealed, so the file is whole whatever its checksum says.
        if (opened.ok && check !== 'matches') this.#writeChecksum(file)
        return opened
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
    this.#closeUnclosed()
    const db = this.#db
    if (!db && this.#pending === 0) return false
    this.#db = null
    if (db) this.#close(db)
    this.#emit()
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
      const read = this.#readFile()
      if (!read) return { ok: false, reason: 'damaged' }
      const { file, check } = read
      let oldKey: Buffer | null = null
      let created: NewKey | null = null
      try {
        oldKey = await openKey(file, current, this.derive)
        if (!oldKey) return { ok: false, reason: unsealFailure(check) }
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
   * A backup file of the open vault: its database file as it is, with the
   * data key sealed under the password, which must be the current one.
   */
  backup(
    password: string,
  ): Promise<
    | { ok: true; file: Buffer }
    | { ok: false; reason: 'wrong-password' | 'locked' | 'damaged' }
  > {
    return this.#run(async (cancelled) => {
      if (!this.#db) return { ok: false, reason: 'locked' }
      const read = this.#readFile()
      if (!read) return { ok: false, reason: 'damaged' }
      const { file, check } = read
      const sealingKey = await this.derive(
        encodePassword(password),
        file.kdf.salt,
        file.kdf,
      )
      let dataKey: Buffer | null = null
      try {
        dataKey = open(sealingKey, file.key, associatedData(file))
        if (!dataKey) return { ok: false, reason: unsealFailure(check) }
        if (cancelled() || !this.#db) return { ok: false, reason: 'locked' }
        const schema = this.#db.pragma('user_version', {
          simple: true,
        }) as number
        // Operations run one at a time and none is writing, so the file on
        // disk is the whole database.
        const database = readFileSync(
          join(this.dir, databaseName(file.generation)),
        )
        return {
          ok: true,
          file: writeBackup(database, schema, dataKey, sealingKey, file.kdf),
        }
      } finally {
        sealingKey.fill(0)
        dataKey?.fill(0)
      }
    })
  }

  /**
   * Checks a backup file with its password and stages its database in a
   * directory of its own: the key opens, the database opens as a vault's
   * does, its schema is not newer than this app's, and under its new key it
   * passes integrity_check, or quick_check if it came failing the first, so
   * a vault that opens makes a backup that restores. Nothing of the vault
   * changes. The caller discards the result or restores it.
   */
  checkBackup(
    bytes: Buffer,
    password: string,
  ): Promise<
    | { ok: true; staged: StagedBackup }
    | { ok: false; reason: 'invalid' | 'wrong-password' | 'newer' | 'damaged' }
  > {
    return this.#run(async () => {
      const backup = readBackup(bytes)
      if (!backup) return { ok: false, reason: 'invalid' }
      const { header } = backup
      const sealingKey = await this.derive(
        encodePassword(password),
        header.kdf.salt,
        header.kdf,
      )
      let dataKey: Buffer | null = null
      try {
        dataKey = openBackupKey(header, sealingKey)
        if (!dataKey) return { ok: false, reason: 'wrong-password' }
        removeRestoring(this.root)
        return stageBackup(
          this.root,
          backup.database,
          header.kdf,
          dataKey,
          sealingKey,
        )
      } finally {
        sealingKey.fill(0)
        dataKey?.fill(0)
      }
    })
  }

  /** Removes a staged backup and wipes its key. */
  discardBackup(staged: StagedBackup): void {
    staged.dataKey.fill(0)
    rmSync(staged.dir, { recursive: true, force: true })
  }

  /**
   * Puts a staged backup in place of the vault. With the current password,
   * from an open vault, the data key is sealed under that password, so it
   * stays the one to use; without one, only while no vault is open, under
   * the backup's. The vault it replaces is renamed, never deleted. A crash
   * before that rename leaves the old vault; after it, startup finishes the
   * restore from the staged vault.
   */
  async restore(
    staged: StagedBackup,
    currentPassword: string | null,
  ): Promise<Outcome<'wrong-password' | 'exists' | 'locked' | 'damaged'>> {
    // A copy, taken now, so nothing else can wipe the key before this runs;
    // wiped however the call ends, also when the queue refuses it.
    const dataKey = Buffer.from(staged.dataKey)
    try {
      return await this.#run(async (cancelled) => {
        if (cancelled() || !existsSync(staged.dir)) {
          return { ok: false, reason: cancelled() ? 'locked' : 'damaged' }
        }
        let current: VaultFile | null = null
        let currentKey: Buffer | null = null
        try {
          let file = staged.file
          if (currentPassword === null) {
            // An open vault is replaced only with its password.
            if (this.#db) return { ok: false, reason: 'exists' }
          } else {
            if (!this.#db) return { ok: false, reason: 'locked' }
            const read = this.#readFile()
            if (!read) return { ok: false, reason: 'damaged' }
            current = read.file
            currentKey = await openKey(current, currentPassword, this.derive)
            if (!currentKey)
              return { ok: false, reason: unsealFailure(read.check) }
            file = await sealDataKey(
              currentPassword,
              dataKey,
              1,
              this.derive,
              this.kdf,
            )
            if (cancelled() || !this.#db) return { ok: false, reason: 'locked' }
          }
          if (
            !writeFileAtomic(
              join(staged.dir, VAULT_FILE),
              serializeVaultFile(file),
            )
          )
            throw new Error('the restored vault could not be flushed')
          removeStaging(this.root)
          const whole = mkdtempSync(join(this.root, STAGING_PREFIX))
          rmSync(whole, { recursive: true })
          renameSync(staged.dir, whole)
          flushDirectory(this.root)
          this.checkpoint('restore staged')
          if (this.#db) this.#close(this.#db)
          this.#db = null
          let aside: string | null = null
          try {
            if (existsSync(this.dir)) {
              aside = join(this.root, replacedName(new Date()))
              renameSync(this.dir, aside)
              flushDirectory(this.root)
              this.checkpoint('vault moved aside')
            }
            renameSync(whole, this.dir)
          } catch (error) {
            // Nothing was replaced after all: put back and reopen the vault
            // that was there, so the page is not left on a closed one.
            try {
              if (aside && !existsSync(this.dir)) renameSync(aside, this.dir)
              flushDirectory(this.root)
              if (current && currentKey) this.#openWithKey(current, currentKey)
            } catch {
              // Left as it is; startup finds whichever vault is whole.
            }
            if (!this.#db) this.#emit()
            throw error
          }
          // The restored vault is in place: the page shows it either way.
          try {
            flushDirectory(this.root)
            const opened = this.#openWithKey(file, dataKey)
            if (!opened.ok)
              throw new Error(
                `the restored vault did not open: ${opened.reason}`,
              )
          } finally {
            staged.dataKey.fill(0)
            if (!this.#db) this.#emit()
          }
          return { ok: true }
        } finally {
          currentKey?.fill(0)
        }
      })
    } finally {
      dataKey.fill(0)
    }
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
    if (this.#db) this.#close(this.#db)
    this.#db = null
    try {
      rmSync(temporary, { force: true })
      copyFileSync(currentPath, temporary)
      this.checkpoint('copied')
      const copy = openDatabase(temporary, oldKey)
      try {
        changeKey(copy, created.dataKey)
        if (!passesIntegrityCheck(copy)) {
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
    const named = this.#readFile()?.file.generation
    if (named === created.file.generation) {
      console.error(
        `password change committed, then failed: ${errorCode(error)}`,
      )
      if (!this.#db)
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
    this.#closeUnclosed()
    let db: Db
    try {
      db = openDatabase(join(this.dir, databaseName(file.generation)), dataKey)
    } catch (error) {
      const reason = openFailure(error)
      if (reason) return { ok: false, reason }
      throw error
    }
    this.#db = db
    if (removeLeftovers) this.#removeLeftovers(file.generation)
    if (emit) this.#emit()
    return { ok: true }
  }

  #readFile(): { file: VaultFile; check: Check } | null {
    try {
      return readVaultFile(readFileSync(join(this.dir, VAULT_FILE), 'utf8'))
    } catch {
      return null
    }
  }

  /**
   * Rewrites a vault.json that has no checksum, being from before it
   * existed, or one that does not match, now that its key has opened the
   * database. The vault is open either way.
   */
  #writeChecksum(file: VaultFile): void {
    const path = join(this.dir, VAULT_FILE)
    try {
      writeFileAtomic(path, serializeVaultFile(file), this.checkpoint)
    } catch (error) {
      console.error(`writing the vault checksum failed: ${errorCode(error)}`)
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

  /**
   * Closes a connection. One that is busy, with a statement still being
   * stepped, cannot close now; it is kept and closed at the next lock or
   * open. Nothing reaches it meanwhile, since the vault no longer hands it out.
   */
  #close(db: Db): void {
    try {
      db.close()
    } catch (error) {
      this.#unclosed.add(db)
      console.error(`closing the database failed: ${errorCode(error)}`)
    }
  }

  #closeUnclosed(): void {
    for (const db of this.#unclosed) {
      try {
        db.close()
        this.#unclosed.delete(db)
      } catch {
        // Still busy.
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

/**
 * The signal for work begun now, aborted at the vault's next lock or
 * unlock, so that work stops there.
 */
export function signalUntilChange(vault: Vault): () => AbortSignal {
  let controller = new AbortController()
  vault.onChange(() => {
    controller.abort()
    controller = new AbortController()
  })
  return () => controller.signal
}

/**
 * Why a password did not unseal the key. A file that matches its checksum
 * is whole, so the password is wrong, and one without a checksum cannot
 * tell and is taken the same way. One that does not match is damaged.
 */
const unsealFailure = (check: Check): 'damaged' | 'wrong-password' =>
  check === 'differs' ? 'damaged' : 'wrong-password'
