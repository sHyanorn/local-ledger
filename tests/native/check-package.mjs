// Checks the output of `electron-builder --dir`: the fuses read back as
// configured, only the target's SQLite binary ships, and the packaged app
// starts while ignoring the Node and debugger entry points the fuses close.
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import pkg from '../../package.json' with { type: 'json' }
import config from '../../electron-builder.ts'

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
 * Lists the files in an asar archive from its header, which is a pickled
 * JSON tree: UInt32 4, UInt32 header size, then a pickle of the JSON string.
 * @param {string} archive
 */
function listAsar(archive) {
  const fd = openSync(archive, 'r')
  try {
    const sizes = Buffer.alloc(16)
    readSync(fd, sizes, 0, 16, 0)
    const json = Buffer.alloc(sizes.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 16)
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
    walk(JSON.parse(json.toString('utf8')), '')
    return files
  } finally {
    closeSync(fd)
  }
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
          name[0].toUpperCase() + name.slice(1)
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
}

/**
 * Starts the app with the closed entry points in use and expects it to keep running.
 * @param {string} executable
 */
async function checkLaunch(executable) {
  const marker = 'ran-as-node'
  const child = spawn(
    executable,
    ['--inspect=0', '-e', `console.log('${marker}')`],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--require ./missing-module.js',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (data) => (output += data))
  child.stderr.on('data', (data) => (output += data))
  const exited = new Promise((resolve) =>
    child.once('exit', (code) => resolve(code)),
  )
  const result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('running'), 10_000)),
  ])
  check(
    result === 'running',
    `the packaged app keeps running (exit: ${result})`,
  )
  check(!output.includes(marker), 'ELECTRON_RUN_AS_NODE is ignored')
  check(!output.includes('Debugger listening'), '--inspect is ignored')
  if (result === 'running') {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
    } else {
      child.kill()
    }
    await exited
  } else {
    console.log(output)
  }
}

const { executable, resources } = locate()
console.log(`checking ${executable}`)
await checkFuses(executable)
checkFiles(resources)
await checkLaunch(executable)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
