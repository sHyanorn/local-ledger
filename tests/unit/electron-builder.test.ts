import { describe, expect, it } from 'vitest'
import config from '../../electron-builder'

describe('electron-builder configuration', () => {
  it('flips the fuses that close Node and debugger entry points', () => {
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
      enableCookieEncryption: true,
    })
  })
})
