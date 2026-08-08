import { z } from 'zod'

import {
  IMAGE_REPO,
  NAME_RE,
  PORT_MAX,
  PORT_MIN,
  SERVER_DEFAULTS,
} from '../../../shared/constants.js'
import { defaultModelsDir } from './paths.js'

const port = z.number().int().min(PORT_MIN).max(PORT_MAX)

export const settingsSchema = z.object({
  modelsDir: z.string().min(1).default(defaultModelsDir),
  bindAddress: z.string().min(1).default('0.0.0.0'),
  port: port.default(8420),
  defaultImage: z.string().min(1).default(SERVER_DEFAULTS.image),
  defaultCtxSize: z.number().int().min(256).max(4_000_000).default(SERVER_DEFAULTS.ctxSize),
  defaultGpuLayers: z.number().int().min(0).max(9999).default(SERVER_DEFAULTS.gpuLayers),
  defaultThreads: z.number().int().min(1).max(512).default(SERVER_DEFAULTS.threads),
  maxConcurrentDownloads: z.number().int().min(1).max(3).default(1),
  allowCustomImages: z.boolean().default(false),
  imageCheckIntervalHours: z.number().int().min(1).max(168).default(6),
  useHfTransfer: z.boolean().default(false),
})

export const configSchema = z.object({
  version: z.literal(1).default(1),
  username: z.string().min(1).default('admin'),
  passwordHash: z.string().default(''),
  jwtSecret: z.string().default(''),
  hfToken: z.string().default(''),
  settings: settingsSchema.default({}),
})

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().regex(NAME_RE),
  image: z.string().min(1),
  modelPath: z.string().min(1),
  port,
  ctxSize: z.number().int().min(256).max(4_000_000),
  gpuLayers: z.number().int().min(0).max(9999),
  threads: z.number().int().min(1).max(512),
  apiKey: z.string().min(1),
  // Empty string means "autodetect from the image" — same semantics as the
  // script's empty EXTRA_ARGS.
  extraArgs: z.string().default(''),
  autostart: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const profilesSchema = z.object({
  version: z.literal(1).default(1),
  profiles: z.array(profileSchema).default([]),
})

export const stateSchema = z.object({
  version: z.literal(1).default(1),
  /** imageId -> detected llama-server extra args. Keyed by ID, not tag. */
  featureCache: z
    .record(z.object({ extraArgs: z.string(), detectedAt: z.string() }))
    .default({}),
  /** tag -> last known local/remote digests and check timestamps. */
  imageStatus: z
    .record(
      z.object({
        localDigest: z.string().nullable().default(null),
        remoteDigest: z.string().nullable().default(null),
        remoteCheckedAt: z.string().nullable().default(null),
        newestImmutableTag: z.string().nullable().default(null),
        newestBuildAt: z.string().nullable().default(null),
      }),
    )
    .default({}),
  /** Back-off deadline after a registry 429, as an ISO timestamp. */
  registryBackoffUntil: z.string().nullable().default(null),
  jobs: z.array(z.record(z.unknown())).default([]),
})

/** Settings that may be changed through the API. */
export const settingsPatchSchema = settingsSchema.partial().extend({
  // Write-only: the API never hands the token back out.
  hfToken: z.string().optional(),
})

export { IMAGE_REPO }
