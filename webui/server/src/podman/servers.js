import fs from 'node:fs'
import { randomBytes } from 'node:crypto'

import {
  CONTAINER_PORT,
  IMAGE_REPO,
  NAME_RE,
  PORT_MAX,
  PORT_MIN,
} from '../../../shared/constants.js'
import { badRequest, conflict, failedDependency, notFound } from '../lib/errors.js'
import { log } from '../lib/log.js'
import { registerSecret } from '../lib/redact.js'
import { safeResolve } from '../models/paths.js'
import { buildRunArgv, hostModelPath, normalizeModelPath } from './argv.js'
import { buildLabels, parseLabels } from './labels.js'
import {
  containerExists,
  inspectContainer,
  invalidatePsCache,
  listAll,
  listManaged,
  removeContainer,
  runContainer,
  startContainer,
  stopContainer,
} from './client.js'
import { resolveExtraArgs } from './features.js'
import { closeLogSession } from './logstream.js'

/** Shape a `podman ps` entry into what the UI needs. */
export function describeContainer(entry) {
  const labels = parseLabels(entry.Labels ?? {})
  const name = (entry.Names ?? [])[0] ?? entry.Id?.slice(0, 12) ?? 'unbekannt'
  const published = (entry.Ports ?? []).find((p) => p.container_port === CONTAINER_PORT)
  return {
    name,
    id: entry.Id,
    image: entry.Image ?? labels.image,
    state: entry.State ?? 'unknown',
    status: entry.Status ?? '',
    createdAt: entry.CreatedAt ?? labels.createdAt,
    hostPort: published?.host_port ?? labels.hostPort,
    running: entry.State === 'running',
    ...labels,
  }
}

export async function listServers() {
  const entries = await listManaged({ force: true })
  return entries.map(describeContainer).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getServer(name) {
  const servers = await listServers()
  const server = servers.find((s) => s.name === name)
  if (!server) throw notFound(`Kein verwalteter Server namens '${name}'.`)
  return server
}

export async function getServerDetail(name) {
  const server = await getServer(name)
  const inspect = await inspectContainer(name)
  return {
    ...server,
    // The resolved argv is shown in the UI so the user can compare it against a
    // manual run-llama-server.sh invocation.
    command: inspect?.Config?.Cmd ?? null,
    restartPolicy: inspect?.HostConfig?.RestartPolicy?.Name ?? null,
    exitCode: inspect?.State?.ExitCode ?? null,
  }
}

export function generateApiKey() {
  return randomBytes(16).toString('hex')
}

/**
 * Validate a start request before anything is spawned.
 *
 * Two of these checks exist because the script learned them the hard way: a
 * missing model file plus `--restart unless-stopped` produces a silent crash
 * loop, and a taken port produces a container that dies on bind.
 */
export async function validateSpec(ctx, spec, { ignoreName } = {}) {
  const settings = ctx.settings

  if (!NAME_RE.test(spec.name ?? '')) {
    throw badRequest(
      'Ungültiger Containername. Erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich (max. 63 Zeichen).',
    )
  }

  const port = Number(spec.port)
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw badRequest(`Der Port muss zwischen ${PORT_MIN} und ${PORT_MAX} liegen.`)
  }

  if (!settings.allowCustomImages && !spec.image.startsWith(`${IMAGE_REPO}:`)) {
    throw badRequest(
      `Nur Images aus ${IMAGE_REPO} sind erlaubt. Beliebige Images lassen sich in den Einstellungen freischalten.`,
    )
  }

  // Path traversal guard — the same one every filesystem entry point uses.
  const rel = normalizeModelPath(spec.modelPath)
  safeResolve(settings.modelsDir, rel)

  const hostPath = hostModelPath(settings.modelsDir, rel)
  if (!fs.existsSync(hostPath)) {
    throw failedDependency(
      `Modell nicht gefunden: ${hostPath}. Ohne die Datei würde der Container in einer stillen Neustart-Schleife landen.`,
    )
  }

  const all = await listAll()
  for (const entry of all) {
    const entryName = (entry.Names ?? [])[0]
    if (entryName === ignoreName) continue
    const taken = (entry.Ports ?? []).some((p) => p.host_port === port)
    if (taken) {
      throw conflict(`Port ${port} ist bereits von Container '${entryName}' belegt.`)
    }
  }

  return { rel, hostPath, port }
}

/**
 * Create and start a container.
 *
 * @param {object} ctx
 * @param {object} spec name, image, modelPath, port, ctxSize, gpuLayers, threads, apiKey, extraArgs, profileId
 * @param {{replace?: boolean, onLog?: (line: string) => void}} [opts]
 */
export async function createServer(ctx, spec, { replace = false, onLog = () => {} } = {}) {
  const settings = ctx.settings
  const exists = await containerExists(spec.name)
  if (exists && !replace) {
    throw conflict(
      `Ein Container namens '${spec.name}' existiert bereits.`,
      { existing: spec.name },
    )
  }

  const { rel } = await validateSpec(ctx, spec, { ignoreName: exists ? spec.name : undefined })

  if (exists) {
    onLog(`Ersetze vorhandenen Container '${spec.name}' …`)
    closeLogSession(spec.name)
    await stopContainer(spec.name)
    await removeContainer(spec.name, { force: true })
  }

  // Empty extraArgs means "work it out from the image", exactly as the script's
  // empty EXTRA_ARGS does. An explicit value skips detection entirely.
  let extraArgs = (spec.extraArgs ?? '').trim()
  if (!extraArgs) {
    const detected = await resolveExtraArgs(ctx, spec.image, { onLog })
    extraArgs = detected.extraArgs
  } else {
    onLog(`Nutze vorgegebene Zusatzargumente: ${extraArgs}`)
  }

  const apiKey = spec.apiKey || generateApiKey()
  registerSecret(apiKey)

  const labels = buildLabels({
    profileId: spec.profileId,
    modelPath: rel,
    image: spec.image,
    ctxSize: spec.ctxSize,
    gpuLayers: spec.gpuLayers,
    threads: spec.threads,
    hostPort: spec.port,
    extraArgs,
  })

  const argv = buildRunArgv({
    containerName: spec.name,
    image: spec.image,
    hostPort: spec.port,
    modelsDir: settings.modelsDir,
    modelPath: rel,
    ctxSize: spec.ctxSize,
    gpuLayers: spec.gpuLayers,
    threads: spec.threads,
    apiKey,
    extraArgs,
    labels,
  })

  onLog(`Starte ${spec.name} (${spec.image}) auf Port ${spec.port} …`)
  const id = await runContainer(argv)
  log.info(`Server '${spec.name}' gestartet (${id.slice(0, 12)})`)

  return { name: spec.name, id, apiKey, extraArgs }
}

export async function startServer(name) {
  await getServer(name)
  await startContainer(name)
  return getServer(name)
}

export async function stopServer(name) {
  await getServer(name)
  await stopContainer(name)
  return getServer(name)
}

export async function restartServer(name) {
  await stopServer(name)
  return startServer(name)
}

export async function deleteServer(name) {
  await getServer(name)
  closeLogSession(name)
  await stopContainer(name)
  await removeContainer(name, { force: true })
  invalidatePsCache()
  return { removed: name }
}

/**
 * Ask a running llama-server whether it is ready.
 *
 * The target is always 127.0.0.1 on a port taken from our own labels — never
 * from user input — so this cannot be turned into a general-purpose proxy.
 */
export async function serverHealth(name) {
  const server = await getServer(name)
  if (!server.running) return { reachable: false, state: server.state }
  if (!server.hostPort) return { reachable: false, reason: 'Kein veröffentlichter Port.' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`http://127.0.0.1:${server.hostPort}/health`, {
      signal: controller.signal,
    })
    const body = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { raw: body.slice(0, 200) }
    }
    return { reachable: true, status: res.status, body: parsed }
  } catch (err) {
    return { reachable: false, reason: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message }
  } finally {
    clearTimeout(timer)
  }
}
