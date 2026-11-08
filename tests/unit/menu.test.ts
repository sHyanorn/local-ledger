import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'
import { setMenu } from '../../src/main/menu'

const built = vi.hoisted(() => ({ template: [] as unknown[] }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: unknown[]) => (built.template = template),
    setApplicationMenu: () => {},
  },
}))

const items = () =>
  (built.template as MenuItemConstructorOptions[]).flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? item.submenu : []),
  ])

/** Clicks the menu item with this id. */
const click = (id: string) => {
  const handler = items().find((entry) => entry.id === id)?.click
  if (typeof handler !== 'function') throw new Error(`no item ${id}`)
  ;(handler as () => void)()
}

const base = { lock: () => {}, command: () => {}, openReleases: () => {} }

beforeEach(() => {
  built.template = []
})

it('has a Lock item on Cmd/Ctrl+L', () => {
  const lock = vi.fn()
  setMenu({ ...base, lock, packaged: true })
  const item = items().find((entry) => entry.id === 'lock')
  expect(item).toMatchObject({ label: 'Lock', accelerator: 'CmdOrCtrl+L' })
  const click = item?.click as (() => void) | undefined
  click?.()
  expect(lock).toHaveBeenCalledOnce()
})

it('offers reload and DevTools only while developing', () => {
  setMenu({ ...base, packaged: true })
  expect(items().some((entry) => entry.role === 'viewMenu')).toBe(false)
  setMenu({ ...base, packaged: false })
  expect(items().some((entry) => entry.role === 'viewMenu')).toBe(true)
})

it.each([
  ['overview', 'CmdOrCtrl+1'],
  ['transactions', 'CmdOrCtrl+2'],
  ['budgets', 'CmdOrCtrl+3'],
  ['reports', 'CmdOrCtrl+4'],
  ['transfers', 'CmdOrCtrl+5'],
  ['new-transaction', 'CmdOrCtrl+N'],
  ['find', 'CmdOrCtrl+F'],
  ['settings', 'CmdOrCtrl+,'],
])('sends %s on %s', (id, accelerator) => {
  const command = vi.fn()
  setMenu({ ...base, command, packaged: true })
  const item = items().find((entry) => entry.id === id)
  expect(item?.accelerator).toBe(accelerator)
  click(id)
  expect(command).toHaveBeenCalledWith(id)
})

it('opens the releases page from Check for Updates', () => {
  const openReleases = vi.fn()
  setMenu({ ...base, openReleases, packaged: true })
  click('check-for-updates')
  expect(openReleases).toHaveBeenCalledOnce()
})

it('gives every accelerator to one item only', () => {
  setMenu({ ...base, packaged: true })
  const accelerators = items()
    .map((entry) => entry.accelerator)
    .filter(Boolean)
  expect(new Set(accelerators).size).toBe(accelerators.length)
})
