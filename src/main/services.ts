import type { FileFilter } from 'electron'

/**
 * What the vault's handlers ask of the main process: the system file
 * dialogs, which return a path the user chose, and printing a page to PDF.
 */
export interface MainServices {
  /** The file the user picks in the open dialog, or null if cancelled. */
  openPath(filter: FileFilter): Promise<string | null>
  /** Where the user saves in the save dialog, or null if cancelled. */
  savePath(name: string, filter: FileFilter): Promise<string | null>
  /** A static page printed to PDF; fails once the signal aborts. */
  printPdf(html: string, css: string, signal: AbortSignal): Promise<Buffer>
}
