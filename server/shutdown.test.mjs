import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ENTRY = fileURLToPath(new URL('./index.mjs', import.meta.url))

function startRelay(storeFile) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: '0', STORE_FILE: storeFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const listening = new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.includes('listening')) resolve()
    })
    child.on('error', reject)
    child.on('exit', (code) => reject(new Error(`relay exited early (code ${code}): ${out}`)))
  })
  return { child, listening }
}

describe('relay graceful shutdown', () => {
  it('flushes every store to disk on SIGTERM and exits cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-shutdown-'))
    const storeFile = join(dir, 'progress.json')
    const { child, listening } = startRelay(storeFile)
    await listening

    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    const code = await exited

    expect(code).toBe(0)
    for (const name of ['progress.json', 'sessions.json', 'marketplace.json', 'pvp-kills.json', 'claimed-anon.json']) {
      const file = join(dir, name)
      expect(existsSync(file), `${name} should be flushed on shutdown`).toBe(true)
      expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow()
    }
  }, 15_000)
})
