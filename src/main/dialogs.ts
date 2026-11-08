// The system file dialogs, shown by the main process: the page never names
// a path.
import { basename } from 'node:path'
import {
  dialog,
  type BaseWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron'
import { cleanText } from './import/mapping'

/** The open dialog, attached to the window when there is one. */
export const showOpen = (
  window: BaseWindow | null,
  options: OpenDialogOptions,
) =>
  window
    ? dialog.showOpenDialog(window, options)
    : dialog.showOpenDialog(options)

/** The save dialog, attached to the window when there is one. */
export const showSave = (
  window: BaseWindow | null,
  options: SaveDialogOptions,
) =>
  window
    ? dialog.showSaveDialog(window, options)
    : dialog.showSaveDialog(options)

/** A chosen file's name as the page shows it: cleaned, at most 255 characters. */
export const fileLabel = (path: string, fallback: string) =>
  cleanText(basename(path)).slice(0, 255) || fallback
