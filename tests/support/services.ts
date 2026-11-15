import type { MainServices } from '../../src/main/services'

/** The main process as handlers see it; a service not given fails the call. */
export function mainServices(given: Partial<MainServices> = {}): MainServices {
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`unexpected ${name}`))
  return {
    openPath: unexpected('open dialog'),
    savePath: unexpected('save dialog'),
    printPdf: unexpected('print'),
    ...given,
  }
}
