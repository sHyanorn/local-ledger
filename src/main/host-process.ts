// Starts the vault host, hands it the ports of pages, answers its requests
// for dialogs and printing, and ends it at each lock. A host has the time
// below to let its calls settle and exit; then it is killed, which cuts a
// call still running as a crash would. No new host starts until the last
// has gone, so two never work on the vault's files at once.
import { MessageChannelMain, utilityProcess } from 'electron'
import type { MessagePortMain, UtilityProcess } from 'electron'
import type {
  Channel,
  Payload,
  PortAnswer,
  Results,
  VaultState,
} from '../shared/ipc'
import type { IdleLockMinutes } from '../shared/settings'
import { errorCode } from './error-code'
import { fromHost } from './host-protocol'
import type { FromHost, ToHost } from './host-protocol'
import type { MainServices } from './services'
import type { VaultProbe } from './vault/probe'

const EXIT_GRACE_MS = 30_000

interface HostOptions {
  /** The host's bundle. */
  entry: string
  /** The user data directory the vault lives in. */
  root: string
  services: MainServices
  /** Whether the host takes failures injected by tests. */
  testHooks: boolean
  /** The vault opened, closed or changed, or its host ended unasked. */
  onChange: (state: VaultState) => void
  onIdle: (minutes: IdleLockMinutes) => void
}

export class VaultHost {
  readonly #options: HostOptions
  /** The host that serves pages, if one is running. */
  #current: UtilityProcess | null = null
  /** Hosts told to lock, until they exit. */
  readonly #ending = new Set<UtilityProcess>()
  /** Ports of pages, and failures for tests, that wait for the next host. */
  #waiting: { ports: MessagePortMain[]; failures: Channel[] } = {
    ports: [],
    failures: [],
  }
  #failAfterLock: Channel[] = []
  /** Probes of the current host. */
  #probes: ((probe: VaultProbe | null) => void)[] = []
  /** Calls of the self-test, failed if the host ends unasked. */
  readonly #calls = new Set<(error: Error) => void>()
  /** Hosts that have set up their vault. */
  readonly #ready = new WeakSet<UtilityProcess>()
  readonly #exited = new WeakSet<UtilityProcess>()
  #onEmpty: (() => void)[] = []

  constructor(options: HostOptions) {
    this.#options = options
  }

  /** Whether a host process is running, ending or not. */
  get running(): boolean {
    return this.#current !== null || this.#ending.size > 0
  }

  /** Gives a page's port to the host, starting one if there is none. */
  connect(port: MessagePortMain): void {
    if (this.#current) this.#post(this.#current, { type: 'page' }, [port])
    else {
      this.#waiting.ports.push(port)
      this.#startWhenFree()
    }
  }

  /** Tells the host to lock and exit; the next page gets a new one. */
  lock(): void {
    // A page still waiting for a host is gone, or replaced after this lock.
    for (const port of this.#waiting.ports) port.close()
    this.#waiting.ports = []
    this.#waiting.failures.push(...this.#failAfterLock)
    this.#failAfterLock = []
    const host = this.#current
    if (!host) return
    this.#current = null
    // What an ending host sends is dropped, its probes' answers too.
    this.#probes.splice(0).forEach((done) => done(null))
    this.#ending.add(host)
    this.#post(host, { type: 'lock' })
    const kill = setTimeout(() => host.kill(), EXIT_GRACE_MS)
    host.once('exit', () => clearTimeout(kill))
  }

  /** Resolves once no host process is left. */
  ended(): Promise<void> {
    if (!this.running) return Promise.resolve()
    return new Promise((resolve) => this.#onEmpty.push(resolve))
  }

  /** A call as a page makes it, over a port of its own; for the self-test. */
  call<C extends Channel>(
    channel: C,
    payload: Payload<C>,
  ): Promise<Results[C]> {
    const { port1, port2 } = new MessageChannelMain()
    this.connect(port2)
    return new Promise((resolve, reject) => {
      this.#calls.add(reject)
      port1.once('message', ({ data }) => {
        this.#calls.delete(reject)
        port1.close()
        const answer = data as PortAnswer
        if (answer.ok) resolve(answer.result as Results[C])
        else reject(new Error(answer.code))
      })
      port1.start()
      port1.postMessage({ id: 0, channel, payload })
    })
  }

  /** What the self-test checks of the open database, in the host. */
  probe(): Promise<VaultProbe | null> {
    if (!this.#current) return Promise.resolve(null)
    this.#post(this.#current, { type: 'probe' })
    return new Promise((resolve) => this.#probes.push(resolve))
  }

  /** For tests: the next call on the channel fails. */
  failNext(channel: Channel): void {
    if (this.#current) this.#post(this.#current, { type: 'fail-next', channel })
    else this.#waiting.failures.push(channel)
  }

  /** For tests: the first call on the channel after the next lock fails. */
  failAfterLock(channel: Channel): void {
    this.#failAfterLock.push(channel)
  }

  #startWhenFree(): void {
    if (this.#current || this.#ending.size > 0) return
    const { entry, root, testHooks } = this.#options
    const host = utilityProcess.fork(entry, [], { serviceName: 'Vault Host' })
    this.#current = host
    const prints = new Map<number, AbortController>()
    host.on('message', (data: unknown) => {
      if (host !== this.#current) return
      const parsed = fromHost.safeParse(data)
      if (parsed.success) this.#answer(host, parsed.data as FromHost, prints)
      else console.error('vault host sent an invalid message')
    })
    host.once('exit', () => {
      this.#exited.add(host)
      for (const print of prints.values()) print.abort()
      this.#ending.delete(host)
      if (host === this.#current) {
        this.#current = null
        this.#probes.splice(0).forEach((done) => done(null))
        for (const fail of this.#calls) fail(new Error('the vault host ended'))
        this.#calls.clear()
        // Ended unasked: as after a lock, the page goes. One that never
        // started would only fail again for the page that replaced it.
        if (this.#ready.has(host)) this.#options.onChange('locked')
        else console.error('the vault host ended before it was ready')
      }
      if (this.#waiting.ports.length > 0) this.#startWhenFree()
      if (!this.running) this.#onEmpty.splice(0).forEach((done) => done())
    })
    this.#post(host, { type: 'start', root, testHooks })
    const { ports, failures } = this.#waiting
    this.#waiting = { ports: [], failures: [] }
    for (const channel of failures) this.failNext(channel)
    for (const port of ports) this.#post(host, { type: 'page' }, [port])
  }

  /** Answers a request of the current host. */
  #answer(
    host: UtilityProcess,
    message: FromHost,
    prints: Map<number, AbortController>,
  ): void {
    const { services, onChange, onIdle } = this.#options
    const reply = (
      id: number,
      value: Promise<string | Uint8Array | null>,
      done?: () => void,
    ) =>
      value
        .then(
          (value) => this.#post(host, { type: 'answer', id, value }),
          (error: unknown) => {
            console.error(`vault host request failed: ${errorCode(error)}`)
            this.#post(host, { type: 'refused', id })
          },
        )
        .finally(done)
    switch (message.type) {
      case 'ready':
        return void this.#ready.add(host)
      case 'state':
        return onChange(message.state)
      case 'idle':
        return onIdle(message.minutes)
      case 'probe':
        return this.#probes.shift()?.(message.probe)
      case 'open':
        return void reply(message.id, services.openPath(message.filter))
      case 'save':
        return void reply(
          message.id,
          services.savePath(message.name, message.filter),
        )
      case 'print': {
        const controller = new AbortController()
        prints.set(message.id, controller)
        const printed = services
          .printPdf(message.html, message.css, controller.signal)
          .then((pdf) => {
            // Sent as a copy; this one is wiped once it has gone.
            this.#post(host, { type: 'answer', id: message.id, value: pdf })
            pdf.fill(0)
            return undefined
          })
        return void printed.then(
          () => prints.delete(message.id),
          (error: unknown) => {
            prints.delete(message.id)
            if (!controller.signal.aborted)
              console.error(`printing failed: ${errorCode(error)}`)
            this.#post(host, { type: 'refused', id: message.id })
          },
        )
      }
      case 'cancel':
        return prints.get(message.id)?.abort()
    }
  }

  /** Posts to a host unless it has exited. */
  #post(host: UtilityProcess, message: ToHost, ports?: MessagePortMain[]) {
    if (!this.#exited.has(host)) host.postMessage(message, ports)
  }
}
