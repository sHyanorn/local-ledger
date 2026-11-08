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
    })
    this.window.on('resize', () => this.#fit())
    // A BaseWindow leaves its views' pages running when it closes.
    this.window.on('closed', () => {
      this.#view?.webContents.close()
      this.#view = null
    })
    this.replaceView().once('did-finish-load', () => this.window.show())
  }

  get contents(): WebContents | undefined {
    return this.#view?.webContents
  }

  /** Loads the page in a new view and closes the old one with its process. */
  replaceView(): WebContents {
    const view = new WebContentsView({ webPreferences: this.#webPreferences })
    view.setBackgroundColor(background())
    this.window.contentView.addChildView(view)
    const old = this.#view
    this.#view = view
    this.#fit()
    void view.webContents.loadURL(this.#url)
    if (old) {
      this.window.contentView.removeChildView(old)
      old.webContents.close()
    }
    return view.webContents
  }

  #fit(): void {
    const { width, height } = this.window.getContentBounds()
    this.#view?.setBounds({ x: 0, y: 0, width, height })
  }
}

function background(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
}
