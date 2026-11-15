// What the main process does for the vault's handlers: the system file
// dialogs, so the page never names a path, and printing a page to PDF.
import { dialog, type BaseWindow } from 'electron'
import { printPdf } from './export/print'
import type { MainServices } from './services'

/** Dialogs attached to the window when there is one, and printing. */
export function mainServices(window: () => BaseWindow | null): MainServices {
  return {
    openPath: async (filter) => {
      const options = { properties: ['openFile' as const], filters: [filter] }
      const parent = window()
      const chosen = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
    },
    savePath: async (name, filter) => {
      const options = { defaultPath: name, filters: [filter] }
      const parent = window()
      const chosen = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      return chosen.canceled || !chosen.filePath ? null : chosen.filePath
    },
    printPdf,
  }
}
