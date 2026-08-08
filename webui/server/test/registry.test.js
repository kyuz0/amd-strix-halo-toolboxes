import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseRef, stampToIso } from '../src/images/registry.js'
import { catalog, isKnownRef, knownTags } from '../src/images/catalog.js'

test('parses a docker.io reference into repository and tag', () => {
  assert.deepEqual(parseRef('docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-7.14'), {
    repository: 'st3v0rr/amd-strix-halo-toolboxes',
    tag: 'rocm-7.14',
  })
})

test('a reference without a tag defaults to latest', () => {
  assert.deepEqual(parseRef('docker.io/user/repo'), { repository: 'user/repo', tag: 'latest' })
})

test('a port in the registry host is not mistaken for a tag', () => {
  assert.deepEqual(parseRef('registry.local:5000/user/repo'), {
    repository: 'registry.local:5000/user/repo',
    tag: 'latest',
  })
  assert.deepEqual(parseRef('registry.local:5000/user/repo:v2'), {
    repository: 'registry.local:5000/user/repo',
    tag: 'v2',
  })
})

test('converts the CI build stamp to ISO 8601', () => {
  // CI pushes <backend>_<YYYYmmddTHHMMSS> next to the moving channel tag.
  assert.equal(stampToIso('20260801T120000'), '2026-08-01T12:00:00Z')
  assert.equal(stampToIso('nonsense'), null)
})

/* -------------------------------- catalog -------------------------------- */

test('the catalog is derived from the Dockerfile directory', () => {
  const tags = knownTags()
  // These four are the stable backends the repository builds.
  for (const expected of ['vulkan-radv', 'vulkan-amdvlk', 'rocm-7.14', 'rocm-6.4.4']) {
    assert.ok(tags.includes(expected), `expected tag ${expected} in ${tags.join(', ')}`)
  }
})

test('every catalog entry carries a full image reference', () => {
  for (const entry of catalog()) {
    assert.match(entry.ref, /^docker\.io\/st3v0rr\/amd-strix-halo-toolboxes:/)
    assert.ok(entry.ref.endsWith(`:${entry.tag}`))
  }
})

test('only catalog references count as known', () => {
  assert.equal(isKnownRef('docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-radv'), true)
  assert.equal(isKnownRef('docker.io/evil/thing:latest'), false)
  assert.equal(isKnownRef('docker.io/st3v0rr/amd-strix-halo-toolboxes:does-not-exist'), false)
})
