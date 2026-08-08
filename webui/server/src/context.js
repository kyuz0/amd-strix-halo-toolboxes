import { configFile, ensureDirs, logFile, profilesFile, stateFile } from './config/paths.js'
import { configSchema, profilesSchema, stateSchema } from './config/schema.js'
import { JsonStore } from './config/store.js'
import { JobManager } from './lib/jobs.js'
import { log } from './lib/log.js'
import { registerSecret } from './lib/redact.js'

/**
 * The application's shared state, assembled once at boot and passed to route
 * factories. Explicit wiring rather than module-level singletons, so the tests
 * can build an isolated instance against a temp directory.
 */
export function createContext() {
  ensureDirs()
  log.attachFile(logFile)

  const configStore = new JsonStore({
    file: configFile,
    schema: configSchema,
    mode: 0o600,
    log: (msg, err) => log.warn(msg, err),
  })
  const profilesStore = new JsonStore({
    file: profilesFile,
    schema: profilesSchema,
    mode: 0o600,
    log: (msg, err) => log.warn(msg, err),
  })
  const stateStore = new JsonStore({
    file: stateFile,
    schema: stateSchema,
    mode: 0o600,
    log: (msg, err) => log.warn(msg, err),
  })

  configStore.load()
  profilesStore.load()
  stateStore.load()

  const jobs = new JobManager({
    persist: (snapshot) => {
      stateStore.update((s) => {
        s.jobs = snapshot
        return s
      })
    },
  })
  jobs.restore(stateStore.data.jobs)

  const ctx = {
    config: configStore,
    profiles: profilesStore,
    state: stateStore,
    jobs,
    log,
    /** Convenience accessors; the stores stay the source of truth. */
    get settings() {
      return configStore.data.settings
    },
    getConfig: () => configStore.data,
  }

  refreshSecrets(ctx)
  jobs.configureLane('model-download', ctx.settings.maxConcurrentDownloads)
  jobs.configureLane('image-pull', 1)
  jobs.configureLane('feature-detect', 2)
  jobs.configureLane('app-update', 1)

  return ctx
}

/**
 * Teach the redactor every secret we currently hold, so none of them can reach
 * a log line, an SSE frame or an error response.
 */
export function refreshSecrets(ctx) {
  registerSecret(ctx.config.data.hfToken)
  registerSecret(ctx.config.data.jwtSecret)
  for (const profile of ctx.profiles.data.profiles) registerSecret(profile.apiKey)
}
