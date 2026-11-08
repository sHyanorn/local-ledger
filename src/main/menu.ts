import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

export function setMenu({
  lock,
  packaged,
}: {
  lock: () => void
  packaged: boolean
}): void {
  const mac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' } as const] : []),
    {
      label: 'File',
      submenu: [
        { id: 'lock', label: 'Lock', accelerator: 'CmdOrCtrl+L', click: lock },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    // Reload and DevTools only while developing.
    ...(packaged ? [] : [{ role: 'viewMenu' } as const]),
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
