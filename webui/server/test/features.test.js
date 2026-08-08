import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

import { detectExtraArgs } from '../src/podman/features.js'
import { EXTRA_ARGS_NEW, EXTRA_ARGS_OLD } from '../../shared/constants.js'
import { webuiRoot } from '../src/config/paths.js'

const fixture = (name) => fs.readFileSync(`${webuiRoot}/dev/fixtures/${name}`, 'utf8')

test('help output mentioning --load-mode selects the new spelling', () => {
  assert.equal(detectExtraArgs(fixture('llama-server-help-new.txt')), EXTRA_ARGS_NEW)
})

test('help output without --load-mode selects the old spelling', () => {
  assert.equal(detectExtraArgs(fixture('llama-server-help-old.txt')), EXTRA_ARGS_OLD)
})

test('empty or whitespace-only output falls back to the old spelling', () => {
  // Detection failed. The old spelling only warns on new builds, whereas
  // --load-mode aborts on old ones — so it is the safe default.
  assert.equal(detectExtraArgs(''), EXTRA_ARGS_OLD)
  assert.equal(detectExtraArgs('   \n\t '), EXTRA_ARGS_OLD)
  assert.equal(detectExtraArgs(null), EXTRA_ARGS_OLD)
  assert.equal(detectExtraArgs(undefined), EXTRA_ARGS_OLD)
})

test('the decision matches run-llama-server.sh for every branch', () => {
  // The script: empty -> old; contains --load-mode -> new; else -> old.
  assert.equal(detectExtraArgs('usage: llama-server\n  --no-mmap  do not mmap'), EXTRA_ARGS_OLD)
  assert.equal(
    detectExtraArgs('usage: llama-server\n  --load-mode {none,mmap}  how to load'),
    EXTRA_ARGS_NEW,
  )
})

test('an error message on stderr still counts as output and is classified', () => {
  // The script merges stdout and stderr; a build that prints an error but no
  // --load-mode must land on the old spelling, not be treated as "empty".
  assert.equal(detectExtraArgs('error while loading shared libraries: libhipblas.so'), EXTRA_ARGS_OLD)
})
