import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'io.github.shyanorn.local-ledger',
  productName: 'Local Ledger',
  directories: { output: 'release' },
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
}

export default config
