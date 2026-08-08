import { LABEL, LABEL_VERSION } from '../../../shared/constants.js'

/**
 * Ownership is recorded on the container itself rather than in our state file.
 *
 * That way a wiped state.json, a reboot, or a manual `podman start` never
 * leaves an orphan: whatever `podman ps` reports carries everything we need to
 * describe it. The API key is deliberately absent — it lives in profiles.json,
 * because a label is readable by every process of this user.
 */
export function buildLabels(spec) {
  return {
    [LABEL.managed]: 'true',
    [LABEL.version]: LABEL_VERSION,
    [LABEL.profile]: spec.profileId ?? '',
    [LABEL.model]: spec.modelPath,
    [LABEL.image]: spec.image,
    [LABEL.ctx]: String(spec.ctxSize),
    [LABEL.gpuLayers]: String(spec.gpuLayers),
    [LABEL.threads]: String(spec.threads),
    [LABEL.port]: String(spec.hostPort),
    [LABEL.extraArgs]: spec.extraArgs ?? '',
    [LABEL.created]: new Date().toISOString(),
  }
}

/** Recover a server spec from a container's labels. */
export function parseLabels(labels = {}) {
  const num = (key, fallback) => {
    const n = Number(labels[key])
    return Number.isFinite(n) ? n : fallback
  }
  return {
    managed: labels[LABEL.managed] === 'true',
    profileId: labels[LABEL.profile] || null,
    modelPath: labels[LABEL.model] || null,
    image: labels[LABEL.image] || null,
    ctxSize: num(LABEL.ctx, null),
    gpuLayers: num(LABEL.gpuLayers, null),
    threads: num(LABEL.threads, null),
    hostPort: num(LABEL.port, null),
    extraArgs: labels[LABEL.extraArgs] ?? '',
    createdAt: labels[LABEL.created] || null,
  }
}

/** Filter argument that selects only containers this app created. */
export const managedFilter = `label=${LABEL.managed}=true`
