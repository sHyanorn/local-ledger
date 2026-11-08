import { describe, expect, it } from 'vitest'
import { findSandboxFlags } from '../../scripts/check-sandbox-flags.mjs'
import switches from '../../src/main/switches.json' with { type: 'json' }

// Built from parts so this file does not trip the check itself.
const off = (...parts: string[]) => parts.join('')

describe('findSandboxFlags', () => {
  it.each(switches.sandboxOff)('flags --%s', (name) => {
    expect(findSandboxFlags(`first\nelectron . --${name}\nlast`)).toEqual([2])
  })

  it.each([
    off("app.commandLine.appendSwitch('no", "-sandbox')"),
    off('NO', '_SANDBOX=1 electron-vite dev'),
    off('electron-vite dev --no', 'Sandbox'),
    off('ELECTRON_DISABLE', '_SANDBOX=1'),
    off('webPreferences: { sand', 'box: false }'),
  ])('flags %s', (line) => {
    expect(findSandboxFlags(`first\n${line}\nlast`)).toEqual([2])
  })

  it('accepts the sandbox turned on', () => {
    expect(findSandboxFlags('sandbox: true\napp.enableSandbox()')).toEqual([])
  })
})
