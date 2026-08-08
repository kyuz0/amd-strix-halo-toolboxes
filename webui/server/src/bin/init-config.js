#!/usr/bin/env node
/**
 * Called by install.sh to create or update config.json.
 *
 * On a fresh install it generates the JWT secret and a random password, and
 * prints the password on stdout (once) so the installer can show it. On a
 * re-run it only updates port/bind/modelsDir and prints nothing — re-running
 * the installer must never reset the user's credentials.
 *
 * Usage: init-config.js <port> <bindAddress> <modelsDir>
 */
import { configFile, ensureDirs } from '../config/paths.js'
import { configSchema } from '../config/schema.js'
import { JsonStore } from '../config/store.js'
import { generatePassword, hashPassword } from '../auth/password.js'
import { generateSecret } from '../auth/tokens.js'

const [portArg, bindArg, modelsDirArg] = process.argv.slice(2)

async function main() {
  ensureDirs()
  const store = new JsonStore({ file: configFile, schema: configSchema, mode: 0o600 })
  store.load()

  const isFresh = !store.data.passwordHash
  let password = ''

  if (isFresh) {
    password = generatePassword()
    const hash = await hashPassword(password)
    store.data.passwordHash = hash
  }
  if (!store.data.jwtSecret) store.data.jwtSecret = generateSecret()

  store.data.settings = {
    ...store.data.settings,
    port: Number(portArg),
    bindAddress: bindArg,
    modelsDir: modelsDirArg,
  }

  await store.update((c) => c)
  await store.flush()

  // Only the generated password goes to stdout; the installer captures it.
  if (password) process.stdout.write(password)
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})
