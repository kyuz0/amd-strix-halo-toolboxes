#!/usr/bin/env node
/**
 * Emit our buildRunArgv() output, one argument per line, so parity.sh can diff
 * it against what the real run-llama-server.sh would have executed.
 *
 * Usage: build.js '<json spec>'
 */
import { buildRunArgv } from '../../server/src/podman/argv.js'

const spec = JSON.parse(process.argv[2])
process.stdout.write(buildRunArgv(spec).join('\n') + '\n')
