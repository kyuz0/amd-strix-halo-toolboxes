import fsp from 'node:fs/promises'
import path from 'node:path'

import express from 'express'
import { z } from 'zod'

import { conflict, notFound } from '../lib/errors.js'
import { q, validate } from '../lib/validate.js'
import { startDownload } from '../models/download.js'
import { estimateVram } from '../models/estimator.js'
import { listGgufFiles, searchRepos } from '../models/hfapi.js'
import { safeResolve } from '../models/paths.js'
import { diskUsage, invalidateModelCache, scanModels } from '../models/scan.js'
import { listServers, stopServer } from '../podman/servers.js'

const deleteQuery = z.object({
  key: z.string().min(1),
  force: z.coerce.boolean().default(false),
})

const estimateQuery = z.object({
  path: z.string().min(1),
  contexts: z.string().optional(),
  overhead: z.coerce.number().min(0).max(64).default(2),
})

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

const filesQuery = z.object({
  repo: z.string().min(1).max(200),
  revision: z.string().min(1).max(100).default('main'),
})

const downloadBody = z.object({
  repo: z.string().min(1).max(200),
  revision: z.string().min(1).max(100).default('main'),
  include: z.array(z.string().min(1)).min(1).max(500),
  targetSubdir: z.string().min(1).max(200).optional(),
})

export function modelRoutes(ctx) {
  const router = express.Router()
  const modelsDir = () => ctx.settings.modelsDir

  router.get('/', async (req, res, next) => {
    try {
      const [scan, disk] = await Promise.all([scanModels(modelsDir()), diskUsage(modelsDir())])
      res.json({ modelsDir: modelsDir(), ...scan, disk })
    } catch (err) {
      next(err)
    }
  })

  router.post('/refresh', async (req, res, next) => {
    try {
      invalidateModelCache()
      const [scan, disk] = await Promise.all([
        scanModels(modelsDir(), { force: true }),
        diskUsage(modelsDir()),
      ])
      res.json({ modelsDir: modelsDir(), ...scan, disk })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/', validate({ query: deleteQuery }), async (req, res, next) => {
    try {
      const { key, force } = q(req)
      const { groups } = await scanModels(modelsDir(), { force: true })
      const group = groups.find((g) => g.key === key)
      if (!group) throw notFound(`Kein Modell mit dem Schlüssel '${key}'.`)

      // Deleting a model out from under a running server would leave it in a
      // restart loop, so refuse unless the caller explicitly asks us to stop it.
      const servers = await listServers()
      const users = servers.filter((s) => group.files.includes(s.modelPath))
      if (users.length && !force) {
        throw conflict(
          `Das Modell wird von ${users.map((s) => `'${s.name}'`).join(', ')} verwendet.`,
          { servers: users.map((s) => s.name) },
        )
      }
      for (const server of users) {
        await stopServer(server.name)
      }

      let freed = 0
      for (const rel of group.files) {
        const abs = safeResolve(modelsDir(), rel)
        try {
          const stat = await fsp.stat(abs)
          freed += stat.size
          await fsp.rm(abs)
        } catch (err) {
          if (err.code !== 'ENOENT') throw err
        }
      }

      await pruneEmptyDirs(modelsDir(), group.dir)
      invalidateModelCache()

      res.json({ deleted: group.files, freedBytes: freed, stoppedServers: users.map((s) => s.name) })
    } catch (err) {
      next(err)
    }
  })

  router.get('/estimate', validate({ query: estimateQuery }), async (req, res, next) => {
    try {
      const { path: rel, contexts, overhead } = q(req)
      const abs = safeResolve(modelsDir(), rel, { mustExist: true })
      const list = (contexts ?? '')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
      res.json(await estimateVram(abs, { contexts: list, overhead }))
    } catch (err) {
      next(err)
    }
  })

  router.get('/hf/search', validate({ query: searchQuery }), async (req, res, next) => {
    try {
      const { q: query, limit } = q(req)
      res.json({ results: await searchRepos(query, ctx.config.data.hfToken, limit) })
    } catch (err) {
      next(err)
    }
  })

  router.get('/hf/files', validate({ query: filesQuery }), async (req, res, next) => {
    try {
      const { repo, revision } = q(req)
      res.json(await listGgufFiles(repo, ctx.config.data.hfToken, revision))
    } catch (err) {
      next(err)
    }
  })

  router.post('/downloads', validate({ body: downloadBody }), async (req, res, next) => {
    try {
      const job = await startDownload(ctx, req.body)
      res.status(202).json({ jobId: job.id, job: job.toJSON() })
    } catch (err) {
      next(err)
    }
  })

  return router
}

/** Remove directories that a delete left empty, stopping below the root. */
async function pruneEmptyDirs(root, relDir) {
  const absRoot = path.resolve(root)
  let current = path.resolve(absRoot, relDir)
  while (current !== absRoot && current.startsWith(absRoot + path.sep)) {
    let entries
    try {
      entries = await fsp.readdir(current)
    } catch {
      return
    }
    if (entries.length > 0) return
    try {
      await fsp.rmdir(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}
