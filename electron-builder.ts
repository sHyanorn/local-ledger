import type { Configuration } from 'electron-builder'

const sqlite = '**/node_modules/better-sqlite3-multiple-ciphers'

const config: Configuration = {
  appId: 'io.github.shyanorn.local-ledger',
  productName: 'Local Ledger',
  directories: { output: 'release' },
  files: [
    'out/**',
    // The package ships sources and prebuilds for every platform; keep only
    // the N-API binary of the target.
    `!${sqlite}/{deps,src}/**`,
    `!${sqlite}/binding.gyp`,
    `!${sqlite}/prebuilds/!(\${platform}-\${arch}).node`,
  ],
  // Every native module ships N-API prebuilds; nothing is rebuilt for Electron.
  npmRebuild: false,
  // No auto-update (D006), so no update feed is written into the app.
  publish: null,
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // The renderer is served from app://, never from file://.
    grantFileProtocolExtraPrivileges: false,
    enableCookieEncryption: true,
  },
  mac: {
    target: ['dmg'],
    category: 'public.app-category.finance',
    // Ad-hoc signature: unsigned apps do not run on Apple Silicon (D006).
    identity: '-',
    hardenedRuntime: true,
  },
  win: {
    target: ['nsis'],
  },
}

export default config
