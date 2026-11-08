import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { hardenSession } from '../../src/main/hardening'

// Outside Electron the real module only resolves the binary, and fetches it
// when missing; nothing here needs it.
vi.mock('electron', () => ({ app: {} }))

type Handler = (...args: any[]) => unknown

function fakeSession() {
  const handlers: Record<string, Handler> = {}
  const record = (name: string) => (handler: Handler) => {
    handlers[name] = handler
  }
  const session = {
    setPermissionRequestHandler: record('permissionRequest'),
    setPermissionCheckHandler: record('permissionCheck'),
    setDevicePermissionHandler: record('devicePermission'),
    setDisplayMediaRequestHandler: record('displayMedia'),
    setSpellCheckerEnabled: vi.fn(),
    setSpellCheckerLanguages: vi.fn(),
    webRequest: { onBeforeRequest: record('beforeRequest') },
  }
  hardenSession(session as unknown as Session)
  const handler = (name: string): Handler => {
    const found = handlers[name]
    if (!found) throw new Error(`${name} handler not set`)
    return found
  }
  return { session, handler }
}

const PERMISSIONS = [
  'clipboard-read',
  'clipboard-sanitized-write',
  'geolocation',
  'media',
  'notifications',
  'openExternal',
  'fileSystem',
  'hid',
  'serial',
  'usb',
]

describe('hardenSession', () => {
  it.each(PERMISSIONS)('denies a request for %s', (permission) => {
    const callback = vi.fn()
    fakeSession().handler('permissionRequest')(null, permission, callback, {})
    expect(callback).toHaveBeenCalledWith(false)
  })

  it.each(PERMISSIONS)('reports %s as not granted', (permission) => {
    expect(
      fakeSession().handler('permissionCheck')(
        null,
        permission,
        'app://local-ledger',
        {},
      ),
    ).toBe(false)
  })

  it('denies device access', () => {
    expect(
      fakeSession().handler('devicePermission')({ deviceType: 'usb' }),
    ).toBe(false)
  })

  it('shares no screen or window', () => {
    const callback = vi.fn()
    fakeSession().handler('displayMedia')({}, callback)
    expect(callback).toHaveBeenCalledWith({})
  })

  it('turns spellcheck off with no dictionary to download', () => {
    const { session } = fakeSession()
    expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith([])
  })

  it.each([
    ['https://example.com/x.png', true],
    ['http://localhost:5173/', true],
    ['app://local-ledger/index.html', false],
  ])('cancels %s: %s', (url, cancel) => {
    const callback = vi.fn()
    fakeSession().handler('beforeRequest')({ url }, callback)
    expect(callback).toHaveBeenCalledWith({ cancel })
  })
})
