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

beforeEach(() => {
  built.template = []
})

it('has a Lock item on Cmd/Ctrl+L', () => {
  const lock = vi.fn()
  setMenu({ lock, packaged: true })
  const item = items().find((entry) => entry.id === 'lock')
  expect(item).toMatchObject({ label: 'Lock', accelerator: 'CmdOrCtrl+L' })
  const click = item?.click as (() => void) | undefined
  click?.()
  expect(lock).toHaveBeenCalledOnce()
})

it('offers reload and DevTools only while developing', () => {
  setMenu({ lock: () => {}, packaged: true })
  expect(items().some((entry) => entry.role === 'viewMenu')).toBe(false)
  setMenu({ lock: () => {}, packaged: false })
  expect(items().some((entry) => entry.role === 'viewMenu')).toBe(true)
})
