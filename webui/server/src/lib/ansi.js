/*
 * Container logs are full of terminal control sequences. Stripping them
 * server-side means the browser can render plain text with no terminal
 * emulator involved.
 *
 * Built from \u escape strings rather than literal control characters, so the
 * pattern survives editors and tooling that normalise whitespace.
 */

const ESC = '\\u001B'

/** CSI: ESC [ params intermediates final — colours, cursor moves, erases. */
const CSI = `${ESC}\\[[0-?]*[ -/]*[@-~]`
/** OSC: ESC ] ... terminated by BEL or ESC \\ — window titles and friends. */
const OSC = `${ESC}\\][\\s\\S]*?(?:\\u0007|${ESC}\\\\)`
/** Two-character escapes such as ESC ( B. */
const SHORT = `${ESC}[@-Z\\\\-_]`

const ANSI_RE = new RegExp(`${CSI}|${OSC}|${SHORT}`, 'g')

/**
 * Remaining C0 controls plus DEL, keeping tab. Carriage return and newline are
 * already consumed by the line splitter in lib/exec.js, so anything left here
 * is noise.
 */
// Matching control characters is precisely this module's job.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')

export function stripAnsi(text) {
  if (typeof text !== 'string') return ''
  return text.replace(ANSI_RE, '').replace(CONTROL_RE, '').trimEnd()
}
