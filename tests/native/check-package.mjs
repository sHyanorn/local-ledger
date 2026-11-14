// Checks the output of `electron-builder --dir`: the fuses read back as
// configured, only the target's SQLite binary ships, the packaged app passes
// its self-test while the Node and debugger entry points it closes are in
// use, and it refuses a remote debugging port.
import { execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import pkg from '../../package.json' with { type: 'json' }
import config from '../../electron-builder.ts'
import { networkRequests } from './net-log.mjs'

const RELEASE = 'release'
const SQLITE = 'node_modules/better-sqlite3-multiple-ciphers'
const target = `${process.platform}-${process.arch}`
let failures = 0

/** @param {boolean} ok @param {string} message */
function check(ok, message) {
  console.log(`${ok ? 'ok' : 'FAIL'}: ${message}`)
  if (!ok) failures++
}

function locate() {
  const productName = config.productName ?? pkg.name
  const dirs = readdirSync(RELEASE)
  if (process.platform === 'darwin') {
    const dir = dirs.find(
      (d) =>
        d.startsWith('mac') &&
        existsSync(join(RELEASE, d, `${productName}.app`)),
    )
    if (!dir) throw new Error('no macOS app in release/')
    const bundle = join(RELEASE, dir, `${productName}.app`)
    return {
      bundle,
      executable: join(bundle, 'Contents', 'MacOS', productName),
      resources: join(bundle, 'Contents', 'Resources'),
    }
  }
  const dir = dirs.find((d) => d.endsWith('-unpacked'))
  if (!dir) throw new Error('no unpacked app in release/')
  const name = process.platform === 'win32' ? `${productName}.exe` : pkg.name
  return {
    executable: join(RELEASE, dir, name),
    resources: join(RELEASE, dir, 'resources'),
  }
}

/**
 * Reads the header of an asar archive, which is a pickled JSON tree: UInt32
 * 4, UInt32 header size, then a pickle of the JSON string. The files' data
 * follows the header.
 * @param {string} archive
 */
function asarHeader(archive) {
  const fd = openSync(archive, 'r')
  try {
    const sizes = Buffer.alloc(16)
    readSync(fd, sizes, 0, 16, 0)
    const json = Buffer.alloc(sizes.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 16)
    return {
      tree: JSON.parse(json.toString('utf8')),
      dataStart: 8 + sizes.readUInt32LE(4),
    }
  } finally {
    closeSync(fd)
  }
}

/** @param {string} archive */
function listAsar(archive) {
  /** @type {string[]} */
  const files = []
  /** @param {{ files?: Record<string, any> }} node @param {string} prefix */
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, path)
      else files.push(path)
    }
  }
  walk(asarHeader(archive).tree, '')
  return files
}

/**
 * Reads a file at the root of an asar archive. Its header entry gives the
 * size, and the offset, as a string, from the start of the files' data.
 * @param {string} archive
 * @param {string} name
 */
function readAsarFile(archive, name) {
  const { tree, dataStart } = asarHeader(archive)
  const { offset, size } = tree.files[name]
  const data = Buffer.alloc(size)
  const fd = openSync(archive, 'r')
  try {
    readSync(fd, data, 0, size, dataStart + Number(offset))
  } finally {
    closeSync(fd)
  }
  return data.toString('utf8')
}

/** @param {string} dir @returns {string[]} */
function listDir(dir, prefix = '') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listDir(join(dir, entry.name), path) : [path]
  })
}

/** @param {string} executable */
async function checkFuses(executable) {
  const wire = await getCurrentFuseWire(executable)
  for (const [name, wanted] of Object.entries(config.electronFuses ?? {})) {
    const option =
      FuseV1Options[
        /** @type {keyof typeof FuseV1Options} */ (
          name.charAt(0).toUpperCase() + name.slice(1)
        )
      ]
    const state = wire[option]
    check(
      state === (wanted ? FuseState.ENABLE : FuseState.DISABLE),
      `fuse ${name} is ${wanted ? 'on' : 'off'}`,
    )
  }
}

/** @param {string} resources */
function checkFiles(resources) {
  const packed = listAsar(join(resources, 'app.asar'))
  const unpacked = listDir(join(resources, 'app.asar.unpacked'))
  // The asar header also lists the files it keeps unpacked.
  const all = [...new Set([...packed, ...unpacked])]
  check(
    packed.includes('out/main/index.js'),
    'the main bundle is inside app.asar',
  )
  check(
    unpacked.includes(`${SQLITE}/prebuilds/${target}.node`),
    `the ${target} SQLite binary is unpacked next to app.asar`,
  )
  const binaries = all.filter((file) => file.endsWith('.node'))
  check(
    binaries.length === 1,
    `no other native binary ships (found: ${binaries.join(', ') || 'none'})`,
  )
  check(
    !all.some(
      (file) =>
        file.startsWith(`${SQLITE}/deps/`) || file.startsWith(`${SQLITE}/src/`),
    ),
    'the SQLite sources are left out',
  )
  check(
    !existsSync(join(resources, 'app-update.yml')),
    'no update feed is configured',
  )
  // Only the build output, package.json and runtime dependencies: no
  // sources, scripts, tests or demo data.
  const roots = [...new Set(all.map((file) => file.split('/')[0]))].sort()
  check(
    roots.join() === 'node_modules,out,package.json',
    `app.asar holds only out/, package.json and node_modules/ (found: ${roots.join(', ')})`,
  )
  check(
    all.every(
      (file) =>
        !file.startsWith('out/') ||
        /^out\/(main|preload|renderer)\//.test(file),
    ),
    'out/ holds only the main, preload and renderer builds',
  )
}

/**
 * Where the packaged app keeps its data when nothing overrides it: Electron
 * names the directory after the package.json it runs from, by its
 * productName, or else its name.
 * @param {string} resources
 */
function defaultUserData(resources) {
  const packaged = JSON.parse(
    readAsarFile(join(resources, 'app.asar'), 'package.json'),
  )
  const name = packaged.productName ?? packaged.name
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', name)
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
      name,
    )
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), name)
}

/**
 * Names, sizes and modification times of everything under dir.
 * @param {string} dir
 */
function snapshot(dir) {
  return listDir(dir)
    .map((file) => {
      const stats = lstatSync(join(dir, file))
      return `${file} ${stats.size} ${stats.mtimeMs}`
    })
    .sort()
    .join('\n')
}

/**
 * Runs the packaged app until it exits, or kills it after a minute.
 * @param {string} executable
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {Promise<{ code: number | null, output: string }>}
 */
async function run(executable, args, env = {}) {
  const child = spawn(executable, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => (output += data))
  child.stderr.on('data', (data) => (output += data))
  /** @type {Promise<number | null>} */
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const timer = setTimeout(() => {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    } else {
      child.kill('SIGKILL')
    }
  }, 60_000)
  const code = await exited
  clearTimeout(timer)
  console.log(output.trimEnd().replace(/^/gm, '  | '))
  return { code, output }
}

/** @param {string} executable @param {string} resources */
async function checkLaunch(executable, resources) {
  // If a fuse failed, ELECTRON_RUN_AS_NODE would run the -e script, and
  // --inspect would start a debugger.
  const marker = 'ran-as-node'
  const scratch = mkdtempSync(join(tmpdir(), 'ledger-package-'))
  const netLog = join(scratch, 'net-log.json')
  const userData = defaultUserData(resources)
  const sentinel = !existsSync(userData)
  if (sentinel) {
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'vault.json'), '{"sentinel":true}')
  }
  const before = snapshot(userData)
  const selfTest = await run(
    executable,
    [
      '--inspect=0',
      '--self-test',
      `--log-net-log=${netLog}`,
      '-e',
      `console.log('${marker}')`,
    ],
    { ELECTRON_RUN_AS_NODE: '1' },
  )
  check(
    snapshot(userData) === before,
    `the self-test leaves ${userData} untouched`,
  )
  if (sentinel) rmSync(userData, { recursive: true, force: true })
  const requests = existsSync(netLog) ? networkRequests(netLog) : ['no net log']
  check(
    requests.length === 0,
    `the packaged app makes no network request (${requests.join(', ') || 'none'})`,
  )
  rmSync(scratch, { recursive: true, force: true })
  check(
    selfTest.code === 0 && selfTest.output.includes('self-test passed'),
    'the packaged app passes its self-test',
  )
  check(!selfTest.output.includes(marker), 'ELECTRON_RUN_AS_NODE is ignored')
  check(!selfTest.output.includes('Debugger listening'), '--inspect is ignored')

  const debugging = await run(executable, [
    '--remote-debugging-port=0',
    '--self-test',
  ])
  check(
    debugging.code === 1 &&
      debugging.output.includes(
        'Refusing to start with --remote-debugging-port.',
      ),
    'the packaged app refuses a remote debugging port',
  )
}

/**
 * The ad-hoc signature must cover the whole bundle, fuses included.
 * @param {string} bundle
 */
function checkSignature(bundle) {
  let ok = true
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], {
      stdio: 'inherit',
    })
  } catch {
    ok = false
  }
  check(ok, 'the ad-hoc signature verifies')
}

const { bundle, executable, resources } = locate()
console.log(`checking ${executable}`)
await checkFuses(executable)
checkFiles(resources)
if (bundle) checkSignature(bundle)
await checkLaunch(executable, resources)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
