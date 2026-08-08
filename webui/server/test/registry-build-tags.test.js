import assert from 'node:assert/strict'
import { test } from 'node:test'

import { newestBuildFromTags } from '../src/images/registry.js'

const TAGS = [
  'rocm-6.4.4',
  'rocm-7.14',
  'rocm-7.14_20260701T090000',
  'rocm-7.14_20260801T120000',
  'rocm-7.14_20260615T235959',
  'vulkan-radv',
  'vulkan-radv_20260805T100000',
]

test('picks the newest immutable build tag for a backend', () => {
  const build = newestBuildFromTags(TAGS, 'rocm-7.14')
  assert.equal(build.tag, 'rocm-7.14_20260801T120000')
  assert.equal(build.builtAt, '2026-08-01T12:00:00Z')
})

test('does not confuse one backend’s build tags with another’s', () => {
  const build = newestBuildFromTags(TAGS, 'vulkan-radv')
  assert.equal(build.tag, 'vulkan-radv_20260805T100000')
})

test('a backend with no build tags yields null', () => {
  // The prune workflow deletes old immutable tags, so this is the normal state
  // of the repository — the UI just omits the build date.
  assert.equal(newestBuildFromTags(TAGS, 'rocm-6.4.4'), null)
  assert.equal(newestBuildFromTags(TAGS, 'vulkan-amdvlk'), null)
})

test('an empty or missing tag list yields null rather than throwing', () => {
  assert.equal(newestBuildFromTags([], 'rocm-7.14'), null)
  assert.equal(newestBuildFromTags(null, 'rocm-7.14'), null)
  assert.equal(newestBuildFromTags(undefined, 'rocm-7.14'), null)
})

test('a channel tag whose name is a prefix of another does not cross over', () => {
  // 'rocm-7.1' must not match 'rocm-7.14_...'.
  const tags = ['rocm-7.1_20260101T000000', 'rocm-7.14_20260801T120000']
  assert.equal(newestBuildFromTags(tags, 'rocm-7.1').tag, 'rocm-7.1_20260101T000000')
  assert.equal(newestBuildFromTags(tags, 'rocm-7.14').tag, 'rocm-7.14_20260801T120000')
})
