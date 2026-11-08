// Fails when a file in the repository turns off the Chromium sandbox, so no
// test, script or workflow can pass by running without it. Markdown is
// skipped. A line that only reads the switch carries ALLOW to be exempt.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FLAG =
  /no[-_]?sandbox|disable-setuid-sandbox|electron_disable_sandbox|sandbox\s*:\s*false/i
const ALLOW = 'sandbox-check: allow'

/**
 * @param {string} text
 * @returns {number[]} 1-based numbers of the lines that turn the sandbox off
 */
export function findSandboxFlags(text) {
  return text
    .split('\n')
    .flatMap((line, index) =>
      FLAG.test(line) && !line.includes(ALLOW) ? [index + 1] : [],
    )
}

function main() {
  const self = relative(process.cwd(), fileURLToPath(import.meta.url))
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => file && file !== self && !file.endsWith('.md'))
  let found = 0
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // deleted but not yet staged
    }
    if (text.includes('\0')) continue
    for (const line of findSandboxFlags(text)) {
      console.error(`${file}:${line}: the Chromium sandbox must stay on`)
      found++
    }
  }
  if (found > 0) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
