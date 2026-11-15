// The main process holds no ledger data: from its entry, no import reaches
// the vault, its database or the code that reads them, which the vault host
// runs, and only ipc.ts listens on ipcMain. Type-only imports are erased in
// the build and do not count.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const IMPORT =
  /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?'([^']+)'/gm

/** The source files and packages an entry imports, directly or not. */
function imports(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    if (!file.endsWith('.ts')) return
    const source = readFileSync(join(ROOT, file), 'utf8')
    for (const [, typeOnly, specifier] of source.matchAll(IMPORT)) {
      if (typeOnly) continue
      const path = specifier!.replace(/\?.*$/, '')
      if (!path.startsWith('.')) packages.add(path)
      else {
        // Posix paths, so the names match on Windows too.
        const base = posix.join(posix.dirname(file), path)
        const found = [base, `${base}.ts`, `${base}/index.ts`].find(
          (candidate) =>
            /\.\w+$/.test(candidate) && existsSync(join(ROOT, candidate)),
        )
        if (!found) throw new Error(`${file}: ${specifier} not found`)
        visit(found)
      }
    }
  }
  visit(entry)
  return { files: [...files], packages: [...packages] }
}

/** Modules that hold or read the vault and what is in it. */
const holdsData = (file: string) =>
  /^src\/main\/(vault|ledger|import|backup)\//.test(file) ||
  (file.startsWith('src/main/export/') &&
    file !== 'src/main/export/print.ts') ||
  [
    'src/main/dispatch.ts',
    'src/main/password-change.ts',
    'src/main/host.ts',
  ].includes(file)

describe('the main process', () => {
  const main = imports('src/main/index.ts')

  it('reaches no module that holds or reads ledger data', () => {
    expect(main.files.filter(holdsData)).toEqual([])
    expect(main.packages).not.toContain('better-sqlite3-multiple-ciphers')
  })

  it('listens on ipcMain only in ipc.ts', () => {
    const listening = main.files.filter(
      (file) =>
        file.endsWith('.ts') &&
        /\bipcMain\b/.test(readFileSync(join(ROOT, file), 'utf8')),
    )
    expect(listening).toEqual(['src/main/ipc.ts'])
  })
})

it('the vault host reaches the vault and its database', () => {
  const host = imports('src/main/host.ts')
  expect(host.files).toContain('src/main/vault/vault.ts')
  expect(host.files).toContain('src/main/vault/database.ts')
  expect(host.packages).toContain('better-sqlite3-multiple-ciphers')
})
