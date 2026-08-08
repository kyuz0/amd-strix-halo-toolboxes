import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stripAnsi } from '../src/lib/ansi.js'

// Built via char codes so no literal control character ever sits in this file.
const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const NUL = String.fromCharCode(0x00)

test('strips CSI colour sequences', () => {
  assert.equal(stripAnsi(`${ESC}[32mgreen${ESC}[0m text`), 'green text')
  assert.equal(stripAnsi(`${ESC}[1;31mERROR${ESC}[m: nope`), 'ERROR: nope')
})

test('strips OSC sequences terminated by BEL or ST', () => {
  assert.equal(stripAnsi(`${ESC}]0;window title${BEL}after`), 'after')
  assert.equal(stripAnsi(`${ESC}]0;title${ESC}\\after`), 'after')
})

test('strips cursor movement and erase sequences', () => {
  assert.equal(stripAnsi(`${ESC}[2K${ESC}[1Gprogress`), 'progress')
})

test('leaves ordinary text and tabs alone', () => {
  assert.equal(stripAnsi('plain text'), 'plain text')
  assert.equal(stripAnsi('col1\tcol2'), 'col1\tcol2')
})

test('drops stray control characters but keeps the visible payload', () => {
  assert.equal(stripAnsi(`bell${BEL}gone`), 'bellgone')
  assert.equal(stripAnsi(`null${NUL}byte`), 'nullbyte')
})

test('trims trailing whitespace left behind by a redraw', () => {
  assert.equal(stripAnsi('value   '), 'value')
})

test('non-strings become the empty string rather than throwing', () => {
  assert.equal(stripAnsi(undefined), '')
  assert.equal(stripAnsi(null), '')
  assert.equal(stripAnsi(42), '')
})
