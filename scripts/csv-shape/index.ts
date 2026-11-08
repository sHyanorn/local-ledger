// npm run csv:shape -- <file.csv> [more files]
// Prints the structure of bank CSV exports, never their values (shape.ts).
import { readFileSync, statSync } from 'node:fs'
import { FileError, MAX_FILE_BYTES } from '../../src/main/import/csv'
import { describe } from './shape'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: npm run csv:shape -- <file.csv> [more files]')
  process.exit(1)
}
files.forEach((file, index) => {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) throw new FileError('too-large')
    console.log(describe(readFileSync(file), index).join('\n'))
  } catch (error) {
    const reason =
      error instanceof FileError
        ? error.code
        : ((error as { code?: string }).code ?? 'unreadable')
    console.log(`File ${index + 1}\n  cannot be read: ${reason}`)
  }
})
