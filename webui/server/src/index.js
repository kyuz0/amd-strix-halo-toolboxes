import { createApp } from './app.js'
import { startUpdateScheduler } from './images/service.js'
import { scheduleReconcile } from './podman/autostart.js'
import { createContext } from './context.js'
import { isMock } from './lib/exec.js'
import { log } from './lib/log.js'

const ctx = createContext()
const app = createApp(ctx)

const { bindAddress, port } = ctx.settings

if (!ctx.config.data.jwtSecret) {
  log.error(
    'Kein JWT-Secret konfiguriert. Führe webui/install.sh aus — der Dienst startet ohne Secret nicht.',
  )
  process.exit(1)
}

const server = app.listen(port, bindAddress, () => {
  log.info(`Strix Halo WebUI lauscht auf http://${bindAddress}:${port}${isMock ? ' (Mock-Modus)' : ''}`)
  if (!ctx.config.data.passwordHash) {
    log.warn('Es ist noch kein Passwort gesetzt — eine Anmeldung ist derzeit nicht möglich.')
  }
  startUpdateScheduler(ctx)
  scheduleReconcile(ctx)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${port} ist bereits belegt. Ändere ihn in den Einstellungen oder beende den anderen Dienst.`)
  } else {
    log.error('Server konnte nicht starten', err)
  }
  process.exit(1)
})

// SSE responses keep sockets open; without an explicit close they would hold
// the shutdown until systemd's TimeoutStopSec runs out.
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log.info(`${signal} empfangen, fahre herunter …`)
  server.close()
  server.closeAllConnections?.()
  try {
    await Promise.all([ctx.config.flush(), ctx.profiles.flush(), ctx.state.flush()])
  } catch (err) {
    log.warn('Konfiguration konnte beim Herunterfahren nicht geschrieben werden', err)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('unhandledRejection', (err) => {
  log.error('Unbehandelte Promise-Ablehnung', err instanceof Error ? err : new Error(String(err)))
})
process.on('uncaughtException', (err) => {
  log.error('Unbehandelte Ausnahme', err)
  // systemd restarts us; carrying on with corrupt state would be worse.
  process.exit(1)
})
