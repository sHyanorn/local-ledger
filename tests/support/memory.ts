import { execFileSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

/** Byte strings to count, by name. */
export type Needles = Record<string, Buffer>

/** A text as strings hold it in memory: one byte per character, and UTF-16LE. */
export const encoded = (name: string, text: string): Needles => ({
  [`${name} ascii`]: Buffer.from(text, 'latin1'),
  [`${name} utf16`]: Buffer.from(text, 'utf16le'),
})

/**
 * Counts each needle in a run of chunks in one pass, also where one spans
 * two chunks: an Aho-Corasick automaton, with a state for each prefix of a
 * needle and a move for each state and byte.
 */
export class NeedleCounter {
  readonly #needles: [string, Buffer][]
  readonly #found: number[]
  readonly #moves: Int32Array
  /** The needles that end in each state, those of its suffixes included. */
  readonly #ends: number[][]
  readonly #ending: Uint8Array
  #state = 0

  constructor(needles: Needles) {
    this.#needles = Object.entries(needles)
    this.#found = this.#needles.map(() => 0)
    const moves: number[][] = [Array(256).fill(-1)]
    const ends: number[][] = [[]]
    this.#needles.forEach(([, needle], index) => {
      let state = 0
      for (const byte of needle) {
        if (moves[state]![byte] === -1) {
          moves[state]![byte] = moves.length
          moves.push(Array(256).fill(-1))
          ends.push([])
        }
        state = moves[state]![byte]!
      }
      ends[state]!.push(index)
    })
    // Breadth first, so a state's longest proper suffix that is also a
    // prefix (its fallback) is complete before the state is reached.
    const fallback = moves.map(() => 0)
    const queue = [0]
    // A for...of loop also visits what is pushed while it runs.
    for (const state of queue) {
      for (let byte = 0; byte < 256; byte++) {
        const via = state === 0 ? 0 : moves[fallback[state]!]![byte]!
        const next = moves[state]![byte]!
        if (next === -1) {
          moves[state]![byte] = via
        } else {
          fallback[next] = via
          ends[next]!.push(...ends[via]!)
          queue.push(next)
        }
      }
    }
    this.#moves = Int32Array.from(moves.flat())
    this.#ends = ends
    this.#ending = Uint8Array.from(ends, (needles) => (needles.length ? 1 : 0))
  }

  /** Counts in bytes that follow the previous ones. */
  add(chunk: Buffer): void {
    const moves = this.#moves
    const ending = this.#ending
    let state = this.#state
    for (let at = 0; at < chunk.length; at++) {
      state = moves[(state << 8) | chunk[at]!]!
      if (ending[state]) {
        for (const index of this.#ends[state]!) this.#found[index]! += 1
      }
    }
    this.#state = state
  }

  /** The next bytes do not follow the previous ones. */
  gap(): void {
    this.#state = 0
  }

  /** Every copy of each needle, also those inside a longer needle. */
  get counts(): Record<string, number> {
    return Object.fromEntries(
      this.#needles.map(([name], index) => [name, this.#found[index]!]),
    )
  }

  /**
   * The copies of each needle that are not part of a copy of a longer
   * needle, such as the key's hex inside the x'..' literal.
   */
  own(): Record<string, number> {
    const counts = this.counts
    const own: Record<string, number> = {}
    const longestFirst = [...this.#needles].sort(
      ([, a], [, b]) => b.length - a.length,
    )
    for (const [name, needle] of longestFirst) {
      own[name] = counts[name]!
      for (const [longer, bytes] of longestFirst) {
        if (bytes.length <= needle.length) break
        own[name] -= own[longer]! * occurrences(bytes, needle)
      }
    }
    return own
  }
}

/** How many times the needle occurs in the bytes, overlaps included. */
function occurrences(bytes: Buffer, needle: Buffer): number {
  let count = 0
  for (
    let at = bytes.indexOf(needle);
    at !== -1;
    at = bytes.indexOf(needle, at + 1)
  ) {
    count += 1
  }
  return count
}

/** A process of the app: the main process or one it started. */
interface AppProcess {
  pid: number
  /** Chromium's process type, from its command line. */
  type: string
}

/** Chromium's type of a process, from its command line. */
function processType(commandLine: string): string {
  const type = /--type=(\S+)/.exec(commandLine)?.[1]
  if (!type) return 'unknown'
  const sub = /--utility-sub-type=(\S+)/.exec(commandLine)?.[1]
  return sub ? `${type} ${sub}` : type
}

/** Every running process, as pid, parent pid and command line. */
function processTable(): [number, number, string][] {
  if (process.platform === 'win32') {
    const json = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8' },
    )
    const rows = JSON.parse(json) as {
      ProcessId: number
      ParentProcessId: number
      CommandLine: string | null
    }[]
    return rows.map((row) => [
      row.ProcessId,
      row.ParentProcessId,
      row.CommandLine ?? '',
    ])
  }
  const lines = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], {
    encoding: 'utf8',
  })
  return lines.split('\n').flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+) ?(.*)$/.exec(line)
    return row ? [[Number(row[1]), Number(row[2]), row[3]!]] : []
  })
}

/** The main process and all its descendants, found by parent pid. */
export function appProcesses(mainPid: number): AppProcess[] {
  const table = processTable()
  const found: AppProcess[] = [{ pid: mainPid, type: 'main' }]
  for (let next = 0; next < found.length; next++) {
    const parent = found[next]!.pid
    for (const [pid, ppid, commandLine] of table) {
      if (ppid === parent && pid !== parent) {
        found.push({ pid, type: processType(commandLine) })
      }
    }
  }
  return found
}

/** What one read of a process found, or why it could not be read. */
export interface ProcessScan extends AppProcess {
  /** Bytes read. */
  bytes: number
  /** Bytes of readable mappings that a read refused (Linux only). */
  unread?: number
  /** Bytes of the pages read that the system had compressed (macOS only). */
  compressed?: number
  error?: string
  /** Copies of each needle, not counting those inside a longer one; none on an error. */
  counts: Record<string, number>
}

const CHUNK = 8 * 1024 * 1024
const PAGE = 4096

/** Kernel pages, and private read-only mappings of files: code and constants. */
function holdsData(perms: string, path: string): boolean {
  if (perms[0] !== 'r') return false
  if (/^\[(vvar|vvar_vclock|vsyscall|vdso)\]$/.test(path)) return false
  const fileConstant =
    perms[1] === '-' &&
    perms[3] === 'p' &&
    path.startsWith('/') &&
    !path.endsWith(' (deleted)')
  return !fileConstant
}

/** Reads a process's mappings through /proc; a page that will not read is skipped and counted. */
function readLinux(pid: number, counter: NeedleCounter) {
  let bytes = 0
  let unread = 0
  const chunk = Buffer.allocUnsafe(CHUNK)
  const mem = openSync(`/proc/${pid}/mem`, 'r')
  try {
    const maps = readFileSync(`/proc/${pid}/maps`, 'utf8')
    for (const line of maps.split('\n')) {
      const map = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) \S+ \S+ \S+ *(.*)$/.exec(
        line,
      )
      if (!map || !holdsData(map[3]!, map[4]!)) continue
      const end = Number.parseInt(map[2]!, 16)
      counter.gap()
      for (let at = Number.parseInt(map[1]!, 16); at < end;) {
        let got = 0
        try {
          got = readSync(mem, chunk, 0, Math.min(CHUNK, end - at), at)
        } catch {
          // Nothing read: below.
        }
        if (got > 0) {
          counter.add(chunk.subarray(0, got))
          bytes += got
          at += got
        } else {
          const skipped = Math.min(PAGE, end - at)
          unread += skipped
          at += skipped
          counter.gap()
        }
      }
    }
  } finally {
    closeSync(mem)
  }
  return { bytes, unread }
}

/** Reads a whole file, such as a memory dump. */
function readFile(path: string, counter: NeedleCounter): number {
  let bytes = 0
  const chunk = Buffer.allocUnsafe(CHUNK)
  const file = openSync(path, 'r')
  try {
    for (let got; (got = readSync(file, chunk, 0, CHUNK, null)) > 0;) {
      counter.add(chunk.subarray(0, got))
      bytes += got
    }
  } finally {
    closeSync(file)
  }
  return bytes
}

/** Whether every thread of the process has stopped, or exited. */
function stopped(pid: number): boolean {
  try {
    return readdirSync(`/proc/${pid}/task`).every((thread) => {
      const stat = readFileSync(`/proc/${pid}/task/${thread}/stat`, 'utf8')
      return 'TtZX'.includes(stat[stat.lastIndexOf(')') + 2]!)
    })
  } catch {
    // The process is gone; its read will say so.
    return true
  }
}

/** Sends a signal, unless the process has already exited. */
function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch {
    // Gone; its read will say so.
  }
}

/** Stops the processes, waiting until every thread has stopped. */
function stopAll(pids: number[]): void {
  for (const pid of pids) signal(pid, 'SIGSTOP')
  const deadline = Date.now() + 5000
  for (const pid of pids) {
    while (!stopped(pid)) {
      if (Date.now() > deadline) throw new Error(`process ${pid} did not stop`)
    }
  }
}

const MINIDUMP = resolve(__dirname, 'minidump.ps1')
const WRITTEN_PAGES = resolve(__dirname, 'written-pages.c')

/**
 * Writes a dump of the process's memory to the file. On macOS the program
 * built from written-pages.c writes it, and the bytes of compressed pages
 * in it are returned.
 */
function dump(pid: number, file: string, program: string): number | undefined {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      MINIDUMP,
      '-ProcessId',
      String(pid),
      '-Path',
      file,
    ])
    return undefined
  }
  // macOS: by root, which task_for_pid needs. Only written pages: every
  // readable one would take in the shared cache too and outgrow the disk.
  // A dump takes seconds; one that hangs fails here instead of stalling the
  // test.
  const compressed = execFileSync('sudo', ['-n', program, String(pid), file], {
    encoding: 'utf8',
    timeout: 120_000,
  })
  execFileSync('sudo', ['-n', 'chown', String(process.getuid!()), file])
  return Number(compressed)
}

/** An error as one line, preferring what the tool wrote to stderr. */
const reason = (error: unknown) =>
  (
    (error as { stderr?: Buffer }).stderr?.toString().trim() ||
    (error as Error).message
  )
    .replace(/\s+/g, ' ')
    .slice(0, 300)

/**
 * Counts the needles in the memory of each process. Linux reads /proc with
 * every process stopped, so nothing moves between or during the reads;
 * Windows and macOS write a dump of each in turn, each with its process
 * stopped: a minidump on Windows, and on macOS the pages it has written,
 * compressed ones included.
 */
export function scanProcesses(
  processes: AppProcess[],
  needles: Needles,
  dumps: string,
): ProcessScan[] {
  const scanOne = (target: AppProcess): ProcessScan => {
    const counter = new NeedleCounter(needles)
    try {
      if (process.platform === 'linux') {
        const read = readLinux(target.pid, counter)
        if (read.bytes === 0) throw new Error('nothing read')
        return { ...target, ...read, counts: counter.own() }
      }
      const file = join(dumps, `${target.pid}.dmp`)
      try {
        const compressed = dump(target.pid, file, program)
        const bytes = readFile(file, counter)
        return { ...target, bytes, compressed, counts: counter.own() }
      } finally {
        rmSync(file, { force: true })
      }
    } catch (error) {
      return { ...target, bytes: 0, error: reason(error), counts: {} }
    }
  }
  const program = join(dumps, 'written-pages')
  if (process.platform !== 'linux') {
    mkdirSync(dumps, { recursive: true })
    if (process.platform === 'darwin') {
      execFileSync('clang', ['-o', program, WRITTEN_PAGES])
    }
    return processes.map(scanOne)
  }
  const pids = processes.map((target) => target.pid)
  try {
    stopAll(pids)
    return processes.map(scanOne)
  } finally {
    for (const pid of pids) signal(pid, 'SIGCONT')
  }
}
