// Prints a static page to PDF in a hidden window that runs no JavaScript.
// The page comes from memory at a one-time app:// path; the PDF comes back
// as a buffer, so nothing is written to disk here.
import { BrowserWindow } from 'electron'
import { servePrint } from '../protocol'

export class PrintCancelled extends Error {
  constructor() {
    super('printing was cancelled')
    this.name = 'PrintCancelled'
  }
}

export async function printPdf(
  html: string,
  css: string,
  signal: AbortSignal,
): Promise<Buffer> {
  if (signal.aborted) throw new PrintCancelled()
  // A new window each time: no state carries from one export to the next.
  const window = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      spellcheck: false,
      webgl: false,
    },
  })
  const page = servePrint(
    {
      'report.html': { type: 'text/html; charset=utf-8', body: html },
      'report.css': { type: 'text/css; charset=utf-8', body: css },
    },
    'report.html',
  )
  const cancel = () => window.destroy()
  signal.addEventListener('abort', cancel)
  try {
    await window.loadURL(page.url)
    if (signal.aborted) throw new PrintCancelled()
    return await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    })
  } catch (error) {
    throw signal.aborted ? new PrintCancelled() : error
  } finally {
    signal.removeEventListener('abort', cancel)
    page.release()
    if (!window.isDestroyed()) window.destroy()
  }
}
