// Fails when a file in the repository weakens the Chromium sandbox, so no
// test, script or workflow can pass by running without it. Markdown and the
// list of refused switches itself are skipped.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import switches from '../src/main/switches.json' with { type: 'json' }

const LIST = 'src/main/switches.json'
const FLAG = new RegExp(
  [
    // Matches no-sandbox, NO_SANDBOX and noSandbox alike.
    ...switches.sandboxOff.map((name) => name.split('-').join('[-_]?')),
    'electron[-_]?disable[-_]?sandbox',
    'sandbox\\s*:\\s*false',
  ].join('|'),
  'i',
)

/**
 * @param {string} text
 * @returns {number[]} 1-based numbers of the lines that weaken the sandbox
 */
export function findSandboxFlags(text) {
  return text
    .split('\n')
    .flatMap((line, index) => (FLAG.test(line) ? [index + 1] : []))
}

function main() {
  const self = relative(process.cwd(), fileURLToPath(import.meta.url))
    .split(sep)
    .join('/')
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      (file) => file && file !== self && file !== LIST && !file.endsWith('.md'),
    )
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
