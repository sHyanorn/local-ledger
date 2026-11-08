import { BaseWindow, nativeTheme, WebContentsView } from 'electron'
import type { WebContents, WebPreferences } from 'electron'

/**
 * The app window. Its page lives in a view that is replaced, renderer
 * process and all, whenever the vault opens or closes, so nothing the page
 * held (a typed password, decrypted data) outlives the change.
 */
export class AppWindow {
  readonly window: BaseWindow
  readonly #url: string
  readonly #webPreferences: WebPreferences
  #view: WebContentsView | null = null
  #shown = false

  constructor(url: string, webPreferences: WebPreferences) {
    this.#url = url
    this.#webPreferences = webPreferences
    this.window = new BaseWindow({
      width: 1100,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      title: 'Local Ledger',
      show: false,
      backgroundColor: background(),
      // A translucent sidebar, as macOS apps have; the page leaves it clear.
      ...(MAC
        ? { vibrancy: 'sidebar', visualEffectState: 'followWindow' }
        : {}),
    })
    this.window.on('resize', () => this.#fit())
    // A BaseWindow leaves its views' pages running when it closes.
    this.window.on('closed', () => {
      this.#view?.webContents.close()
      this.#view = null
    })
    this.replaceView()
  }

  get contents(): WebContents | undefined {
    return this.#view?.webContents
  }

  /**
   * Loads the page in a new view and closes the old one with its process,
   * also when the new one cannot be made.
   */
  replaceView(): void {
    const old = this.#view
    this.#view = null
    try {
      const view = new WebContentsView({ webPreferences: this.#webPreferences })
      view.setBackgroundColor(MAC ? '#00000000' : background())
      this.window.contentView.addChildView(view)
      this.#view = view
      this.#fit()
      // Until a page has rendered, the window waits for whichever view is
      // current, since a lock can replace the first one before it loads.
      if (!this.#shown) {
        view.webContents.once('did-finish-load', () => {
          if (this.#view !== view || this.#shown) return
          this.#shown = true
          this.window.show()
        })
      }
      void view.webContents.loadURL(this.#url)
    } finally {
      if (old) {
        this.window.contentView.removeChildView(old)
        old.webContents.close()
      }
    }
  }

  #fit(): void {
    const { width, height } = this.window.getContentBounds()
    this.#view?.setBounds({ x: 0, y: 0, width, height })
  }
}

const MAC = process.platform === 'darwin'

function background(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
}
