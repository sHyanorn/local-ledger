import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { Command } from '../shared/commands'

/** Where "Check for Updates…" leads; the app itself never connects (D006). */
export const RELEASES_URL = 'https://github.com/shyanorn/local-ledger/releases'

export function setMenu({
  lock,
  command,
  openReleases,
  packaged,
}: {
  lock: () => void
  /** Sent to the page, which ignores commands while the vault is locked. */
  command: (name: Command) => void
  openReleases: () => void
  packaged: boolean
}): void {
  const mac = process.platform === 'darwin'
  const item = (
    id: Command,
    label: string,
    accelerator: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    click: () => command(id),
  })
  const settings = item(
    'settings',
    mac ? 'Settings…' : 'Settings',
    'CmdOrCtrl+,',
  )
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: 'Local Ledger',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('new-transaction', 'New Transaction', 'CmdOrCtrl+N'),
        { type: 'separator' },
        { id: 'lock', label: 'Lock', accelerator: 'CmdOrCtrl+L', click: lock },
        ...(mac ? [] : [{ type: 'separator' } as const, settings]),
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('find', 'Find', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: 'Go',
      submenu: [
        item('overview', 'Overview', 'CmdOrCtrl+1'),
        item('transactions', 'All Transactions', 'CmdOrCtrl+2'),
        item('budgets', 'Budgets', 'CmdOrCtrl+3'),
        item('reports', 'Reports', 'CmdOrCtrl+4'),
        item('transfers', 'Transfers', 'CmdOrCtrl+5'),
      ],
    },
    // Reload and DevTools only while developing.
    ...(packaged ? [] : [{ role: 'viewMenu' } as const]),
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          id: 'check-for-updates',
          label: 'Check for Updates…',
          click: openReleases,
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
