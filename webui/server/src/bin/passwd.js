#!/usr/bin/env node
/**
 * Reset the admin password (and, if missing, bootstrap the config) from a
 * shell. This is the recovery path — there is deliberately no open `/setup`
 * endpoint that anyone on the LAN could reach first.
 *
 * Usage:
 *   shx-passwd                 prompt for a new password
 *   shx-passwd --generate      generate one and print it
 *   shx-passwd --stdin         read it from stdin (for scripting)
 */
import readline from 'node:readline'

import { configFile, ensureDirs } from '../config/paths.js'
import { configSchema } from '../config/schema.js'
import { JsonStore } from '../config/store.js'
import { generatePassword, hashPassword } from '../auth/password.js'
import { generateSecret } from '../auth/tokens.js'

const args = process.argv.slice(2)

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const onData = (char) => {
      // Redraw the prompt without echoing what was typed.
      const s = String(char)
      if (s === '\n' || s === '\r' || s === '') {
        process.stdin.removeListener('data', onData)
      } else {
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(prompt)
      }
    }
    process.stdin.on('data', onData)
    rl.question(prompt, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    rl.on('error', reject)
  })
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  ensureDirs()
  const store = new JsonStore({ file: configFile, schema: configSchema, mode: 0o600 })
  store.load()

  let password
  let generated = false
  if (args.includes('--generate')) {
    password = generatePassword()
    generated = true
  } else if (args.includes('--stdin')) {
    password = await readStdin()
  } else {
    password = await readHidden('Neues Passwort: ')
    const again = await readHidden('Wiederholen:    ')
    if (password !== again) {
      process.stderr.write('Die Passwörter stimmen nicht überein.\n')
      process.exit(1)
    }
  }

  if (!password || password.length < 8) {
    process.stderr.write('Das Passwort muss mindestens 8 Zeichen haben.\n')
    process.exit(1)
  }

  const hash = await hashPassword(password)
  await store.update((c) => {
    c.passwordHash = hash
    // Bootstrap a secret too, so a fresh config is immediately usable.
    if (!c.jwtSecret) c.jwtSecret = generateSecret()
    return c
  })
  await store.flush()

  if (generated) {
    process.stdout.write(`\n  Neues Passwort: ${password}\n\n`)
  }
  process.stdout.write(`Passwort für '${store.data.username}' gesetzt (${configFile}).\n`)
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
})
