import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Called between the steps of a multi-file change. The app passes nothing;
 * tests pass one that throws at a chosen step to simulate a crash there.
 */
export type Checkpoint = (step: string) => void
export const noCheckpoint: Checkpoint = () => {}

/** Flushes a directory entry change to disk. Windows cannot open directories. */
export function syncDirectory(dir: string): void {
  if (process.platform === 'win32') return
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Flushes a directory after a rename that has already taken effect, so
 * nothing is undone when the flush fails: returns false instead of throwing.
 */
export function flushDirectory(dir: string): boolean {
  try {
    syncDirectory(dir)
    return true
  } catch {
    return false
  }
}

export function syncFile(path: string): void {
  const fd = openSync(path, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Replaces a file so that a crash leaves either the old content or the new
 * one: write a temporary file, flush it, rename it over the target, flush
 * the directory. The rename is the replacement, so nothing after it throws:
 * returns false when the directory could not be flushed, in which case a
 * power cut could still bring the old file back.
 */
export function writeFileAtomic(
  path: string,
  data: string,
  checkpoint: Checkpoint = noCheckpoint,
): boolean {
  const temporary = `${path}.tmp`
  const fd = openSync(temporary, 'w', 0o600)
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  checkpoint('temporary file written')
  renameSync(temporary, path)
  return flushDirectory(dirname(path))
}
