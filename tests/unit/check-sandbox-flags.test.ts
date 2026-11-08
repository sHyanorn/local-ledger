import { describe, expect, it } from 'vitest'
import { findSandboxFlags } from '../../scripts/check-sandbox-flags.mjs'

// Built from parts so this file does not trip the check itself.
const off = (...parts: string[]) => parts.join('')

describe('findSandboxFlags', () => {
  it.each([
    off('electron . --no', '-sandbox'),
    off("app.commandLine.appendSwitch('no", "-sandbox')"),
    off('NO', '_SANDBOX=1 electron-vite dev'),
    off('electron-vite dev --no', 'Sandbox'),
    off('--disable-setuid', '-sandbox'),
    off('ELECTRON_DISABLE', '_SANDBOX=1'),
    off('webPreferences: { sand', 'box: false }'),
  ])('flags %s', (line) => {
    expect(findSandboxFlags(`first\n${line}\nlast`)).toEqual([2])
  })

  it('accepts the sandbox turned on', () => {
    expect(findSandboxFlags('sandbox: true\napp.enableSandbox()')).toEqual([])
  })

  it('exempts a line marked as only reading the switch', () => {
    const line = off("hasSwitch('no", "-sandbox') // sandbox-check: allow")
    expect(findSandboxFlags(line)).toEqual([])
  })
})
